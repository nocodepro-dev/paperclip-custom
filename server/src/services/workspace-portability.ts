import { mkdir, writeFile, rm, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Db } from "@paperclipai/db";
import { companies } from "@paperclipai/db";
import type {
  CompanyPortabilityFileEntry,
  CompanyPortabilityCollisionStrategy,
} from "@paperclipai/shared";
import { companyPortabilityService } from "./company-portability.js";
import type { StorageService } from "../storage/types.js";
import {
  exportActivityLog,
  exportCostEvents,
  exportHeartbeatRuns,
  importRuntimeLogs,
} from "./workspace-runtime-logs.js";

const WORKSPACE_SCHEMA_VERSION = 1;

// Content types for binary files we roundtrip. Mirrors the set used by
// company-portability's inferContentTypeFromPath / CLI binaryContentTypeByExtension.
const BINARY_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function normalizePortablePath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function shouldIncludePortableFile(filePath: string): boolean {
  const baseName = path.basename(filePath);
  if (baseName === "manifest.json") return true;
  const isMarkdown = baseName.endsWith(".md");
  const isPaperclipYaml = baseName === ".paperclip.yaml" || baseName === ".paperclip.yml";
  const contentType = BINARY_CONTENT_TYPE_BY_EXTENSION[path.extname(baseName).toLowerCase()];
  return isMarkdown || isPaperclipYaml || Boolean(contentType);
}

function readPortableFileEntry(filePath: string, contents: Buffer): CompanyPortabilityFileEntry {
  const contentType = BINARY_CONTENT_TYPE_BY_EXTENSION[path.extname(filePath).toLowerCase()];
  if (!contentType) return contents.toString("utf8");
  return {
    encoding: "base64",
    data: contents.toString("base64"),
    contentType,
  };
}

async function readRootPackageVersion(): Promise<string> {
  try {
    const moduleDir = path.dirname(
      new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
    );
    const candidates = [
      path.resolve(moduleDir, "../../../package.json"),
      path.resolve(moduleDir, "../../../../package.json"),
    ];
    for (const candidate of candidates) {
      try {
        const text = await readFile(candidate, "utf-8");
        const parsed = JSON.parse(text);
        if (parsed.name === "paperclip" || (typeof parsed.name === "string" && parsed.name.includes("paperclip"))) {
          return (parsed.version as string) || "unknown";
        }
      } catch {
        // try next candidate
      }
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function collectDirectoryFiles(
  rootDir: string,
  currentDir: string,
  files: Record<string, CompanyPortabilityFileEntry>,
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".git")) continue;
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await collectDirectoryFiles(rootDir, absolutePath, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const relativePath = path.relative(rootDir, absolutePath).replace(/\\/g, "/");
    if (!shouldIncludePortableFile(relativePath)) continue;
    files[relativePath] = readPortableFileEntry(relativePath, await readFile(absolutePath));
  }
}

export interface WorkspaceExportResult {
  workspaceDir: string;
  companies: number;
  activityLogEntries: number;
  costEvents: number;
  heartbeatRuns: number;
  warnings: string[];
}

export interface WorkspaceImportResult {
  companies: number;
  activityLogEntries: number;
  costEvents: number;
  heartbeatRuns: number;
  warnings: string[];
}

export function resolveWorkspaceDir(configuredPath?: string): string {
  const home = process.env.PAPERCLIP_HOME?.trim() || path.join(os.homedir(), ".paperclip");
  const instance = process.env.PAPERCLIP_INSTANCE_ID?.trim() || "default";
  if (configuredPath && configuredPath.trim()) {
    if (configuredPath.startsWith("~")) {
      return path.join(home, configuredPath.slice(1).replace(/^[/\\]/, ""));
    }
    return configuredPath;
  }
  return path.join(home, "instances", instance, "workspace");
}

export function workspacePortabilityService(db: Db, storage?: StorageService) {
  const companyPortability = companyPortabilityService(db, storage);

  async function exportWorkspace(workspaceDir: string): Promise<WorkspaceExportResult> {
    await mkdir(workspaceDir, { recursive: true });
    // Clean previously-exported content but preserve anything we don't manage (.git, user files)
    await rm(path.join(workspaceDir, "companies"), { recursive: true, force: true });
    await rm(path.join(workspaceDir, "runtime"), { recursive: true, force: true });
    await rm(path.join(workspaceDir, "MANIFEST.json"), { force: true });
    await rm(path.join(workspaceDir, "README.md"), { force: true });
    await rm(path.join(workspaceDir, ".env.template"), { force: true });

    const warnings: string[] = [];
    const allCompanies = await db.select().from(companies);

    for (const company of allCompanies) {
      const exportResult = await companyPortability.exportBundle(company.id, {
        include: {
          company: true,
          agents: true,
          projects: true,
          issues: true,
          skills: true,
          pipelines: true,
          sops: true,
          knowledgeCollections: true,
        },
      });
      warnings.push(...exportResult.warnings);

      const companyDir = path.join(workspaceDir, "companies", exportResult.rootPath);
      await mkdir(companyDir, { recursive: true });
      for (const [relPath, entry] of Object.entries(exportResult.files)) {
        const fullPath = path.join(companyDir, normalizePortablePath(relPath));
        await mkdir(path.dirname(fullPath), { recursive: true });
        if (typeof entry === "string") {
          await writeFile(fullPath, entry, "utf-8");
        } else if (entry && typeof entry === "object" && entry.encoding === "base64") {
          await writeFile(fullPath, Buffer.from(entry.data, "base64"));
        } else {
          // Defensive fallback — unknown encodings stringified as JSON
          await writeFile(fullPath, JSON.stringify(entry, null, 2), "utf-8");
        }
      }

      await writeFile(
        path.join(companyDir, "manifest.json"),
        JSON.stringify(exportResult.manifest, null, 2),
        "utf-8",
      );
    }

    const activityCount = await exportActivityLog(db, workspaceDir);
    const costCount = await exportCostEvents(db, workspaceDir);
    const hbCount = await exportHeartbeatRuns(db, workspaceDir);

    const paperclipVersion = await readRootPackageVersion();

    const topManifest = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      instanceId: process.env.PAPERCLIP_INSTANCE_ID?.trim() || "default",
      paperclipVersion,
      companies: allCompanies.map((c) => ({ id: c.id, name: c.name })),
      stats: {
        companies: allCompanies.length,
        activityLog: activityCount,
        costEvents: costCount,
        heartbeatRuns: hbCount,
      },
    };
    await writeFile(
      path.join(workspaceDir, "MANIFEST.json"),
      JSON.stringify(topManifest, null, 2),
      "utf-8",
    );

    const readme = [
      "# Paperclip Workspace",
      "",
      `Exported: ${topManifest.exportedAt}`,
      `Instance: ${topManifest.instanceId}`,
      `Companies: ${allCompanies.length}`,
      `Activity log entries: ${activityCount}`,
      `Cost events: ${costCount}`,
      `Heartbeat runs: ${hbCount}`,
      "",
      "## Contents",
      "",
      "- `companies/` — one directory per company with agents, projects, tasks, pipelines, SOPs, knowledge metadata",
      "- `runtime/` — compressed activity logs, cost events, heartbeat runs",
      "- `MANIFEST.json` — top-level manifest",
      "",
      "## Restoring on a new machine",
      "",
      "1. Install Paperclip on the new machine",
      "2. Run: `paperclipai workspace clone <git-url>`",
      "3. Re-map any knowledge collection paths that don't resolve",
      "",
    ].join("\n");
    await writeFile(path.join(workspaceDir, "README.md"), readme, "utf-8");

    return {
      workspaceDir,
      companies: allCompanies.length,
      activityLogEntries: activityCount,
      costEvents: costCount,
      heartbeatRuns: hbCount,
      warnings,
    };
  }

  async function importWorkspace(
    workspaceDir: string,
    opts: { collisionStrategy?: CompanyPortabilityCollisionStrategy } = {},
  ): Promise<WorkspaceImportResult> {
    const strategy: CompanyPortabilityCollisionStrategy = opts.collisionStrategy ?? "rename";
    const warnings: string[] = [];

    // Verify top-level manifest exists.
    const manifestPath = path.join(workspaceDir, "MANIFEST.json");
    try {
      await readFile(manifestPath, "utf-8");
    } catch {
      throw new Error(`Workspace manifest not found at ${manifestPath}`);
    }

    const companiesDir = path.join(workspaceDir, "companies");
    let companySlugs: string[] = [];
    try {
      const entries = await readdir(companiesDir, { withFileTypes: true });
      companySlugs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      warnings.push(`No companies directory found at ${companiesDir}`);
    }

    let importedCompanies = 0;
    for (const companySlug of companySlugs) {
      const companyDir = path.join(companiesDir, companySlug);
      try {
        // Sanity: directory must contain something
        const st = await stat(companyDir).catch(() => null);
        if (!st || !st.isDirectory()) {
          warnings.push(`Skipping "${companySlug}": not a directory`);
          continue;
        }

        // Read every portable file in the company dir into an inline file map.
        // companyPortability.importBundle only accepts `inline` or `github` source types,
        // so we must materialize the directory contents into memory here.
        const files: Record<string, CompanyPortabilityFileEntry> = {};
        await collectDirectoryFiles(companyDir, companyDir, files);

        await companyPortability.importBundle(
          {
            source: {
              type: "inline",
              rootPath: companySlug,
              files,
            },
            target: { mode: "new_company" },
            collisionStrategy: strategy,
            include: {
              company: true,
              agents: true,
              projects: true,
              issues: true,
              skills: true,
              pipelines: true,
              sops: true,
              knowledgeCollections: true,
            },
          },
          null,
        );
        importedCompanies++;
      } catch (err) {
        warnings.push(
          `Failed to import company "${companySlug}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const logResult = await importRuntimeLogs(db, workspaceDir);

    return {
      companies: importedCompanies,
      activityLogEntries: logResult.activity,
      costEvents: logResult.costs,
      heartbeatRuns: logResult.heartbeats,
      warnings,
    };
  }

  return { exportWorkspace, importWorkspace };
}
