import { readdir, stat, readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companySops, sopAssets } from "@paperclipai/db";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

const CONTENT_TYPE_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

interface ScannedAsset {
  relativePath: string;
  localPath: string;
  kind: string;
  stepNumber: number | null;
}

/**
 * Detect if markdown content is a ReplayDoc export.
 * ReplayDoc exports typically contain structured step headings
 * with adjacent screenshot references using step_N naming.
 */
function detectReplayDoc(markdown: string): {
  isReplayDoc: boolean;
  stepCount: number;
  screenshotRefs: string[];
} {
  const replayDocComment = /<!--\s*replaydoc/i.test(markdown);
  const stepPattern = /!\[.*?\]\(.*?step[_-]?(\d+).*?\)/gi;
  const refs: string[] = [];
  let match;
  while ((match = stepPattern.exec(markdown)) !== null) {
    refs.push(match[0]);
  }

  const stepHeadings = markdown.match(/^#{1,3}\s*(step\s+\d+)/gim) ?? [];

  return {
    isReplayDoc: replayDocComment || refs.length >= 2,
    stepCount: Math.max(stepHeadings.length, refs.length),
    screenshotRefs: refs,
  };
}

/**
 * Try to infer which step number an image corresponds to
 * based on filename patterns like step_1.png, step-2.jpg, 01_screenshot.png
 */
function inferStepNumber(filename: string): number | null {
  const stepMatch = filename.match(/step[_-]?(\d+)/i);
  if (stepMatch) return parseInt(stepMatch[1], 10);

  const leadingNum = filename.match(/^(\d+)[_-]/);
  if (leadingNum) return parseInt(leadingNum[1], 10);

  return null;
}

/**
 * Scan a directory for image files to use as SOP assets.
 */
async function scanDirectoryForAssets(dirPath: string): Promise<ScannedAsset[]> {
  const results: ScannedAsset[] = [];

  async function walk(currentPath: string, relativeBase: string) {
    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(currentPath, entry.name);
      const relativePath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await walk(fullPath, relativePath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext)) {
          results.push({
            relativePath,
            localPath: fullPath.replace(/\\/g, "/"),
            kind: "screenshot",
            stepNumber: inferStepNumber(entry.name),
          });
        }
      }
    }
  }

  await walk(dirPath, "");
  return results;
}

/**
 * Find the primary markdown file in a directory.
 */
async function findMarkdownFile(dirPath: string): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return null;
  }

  const mdFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
    .map((e) => e.name);

  if (mdFiles.length === 0) return null;
  if (mdFiles.length === 1) return path.join(dirPath, mdFiles[0]);

  // Prefer README.md or the largest file
  const readme = mdFiles.find((f) => f.toLowerCase() === "readme.md");
  if (readme) return path.join(dirPath, readme);

  let largest = { name: mdFiles[0], size: 0 };
  for (const name of mdFiles) {
    const s = await stat(path.join(dirPath, name));
    if (s.size > largest.size) largest = { name, size: s.size };
  }
  return path.join(dirPath, largest.name);
}

export function sopService(db: Db) {
  return {
    async create(
      companyId: string,
      data: {
        name: string;
        description?: string | null;
        category?: string | null;
        sourceType?: string;
        sourcePath?: string | null;
        markdownBody: string;
        hasScreenshots?: boolean;
        screenshotCount?: number;
      },
    ) {
      const [sop] = await db
        .insert(companySops)
        .values({
          companyId,
          name: data.name,
          description: data.description ?? null,
          category: data.category ?? null,
          sourceType: data.sourceType ?? "upload",
          sourcePath: data.sourcePath?.replace(/\\/g, "/") ?? null,
          markdownBody: data.markdownBody,
          hasScreenshots: data.hasScreenshots ?? false,
          screenshotCount: data.screenshotCount ?? 0,
          status: "draft",
        })
        .returning();

      return sop;
    },

    /**
     * Create an SOP from a local directory path.
     * Scans for the markdown file and screenshot assets.
     */
    async createFromDirectory(
      companyId: string,
      dirPath: string,
      data: {
        name: string;
        description?: string | null;
        category?: string | null;
        sourceType?: string;
      },
    ) {
      const normalizedPath = dirPath.replace(/\\/g, "/").replace(/\/+$/, "");

      // Validate directory exists
      try {
        const s = await stat(normalizedPath);
        if (!s.isDirectory()) throw new Error("Not a directory");
      } catch {
        throw new Error(`Source path is not accessible: ${normalizedPath}`);
      }

      // Find markdown file
      const mdFile = await findMarkdownFile(normalizedPath);
      if (!mdFile) {
        throw new Error(`No markdown file found in: ${normalizedPath}`);
      }

      const markdownBody = await readFile(mdFile, "utf-8");

      // Scan for screenshot assets
      const scannedAssets = await scanDirectoryForAssets(normalizedPath);

      // Detect ReplayDoc format
      const replayDoc = detectReplayDoc(markdownBody);
      const sourceType = replayDoc.isReplayDoc ? "replaydoc_export" : (data.sourceType ?? "local_path");

      // Insert SOP
      const [sop] = await db
        .insert(companySops)
        .values({
          companyId,
          name: data.name,
          description: data.description ?? null,
          category: data.category ?? null,
          sourceType,
          sourcePath: normalizedPath,
          markdownBody,
          hasScreenshots: scannedAssets.length > 0,
          screenshotCount: scannedAssets.length,
          status: "draft",
          metadata: replayDoc.isReplayDoc
            ? { replayDoc: true, stepCount: replayDoc.stepCount }
            : null,
        })
        .returning();

      // Insert assets
      if (scannedAssets.length > 0) {
        await db.insert(sopAssets).values(
          scannedAssets.map((a) => ({
            sopId: sop.id,
            companyId,
            localPath: a.localPath,
            relativePath: a.relativePath,
            kind: a.kind,
            stepNumber: a.stepNumber,
          })),
        );
      }

      return sop;
    },

    async getById(id: string) {
      return db
        .select()
        .from(companySops)
        .where(eq(companySops.id, id))
        .then((rows) => rows[0] ?? null);
    },

    async getDetail(id: string) {
      const sop = await db
        .select()
        .from(companySops)
        .where(eq(companySops.id, id))
        .then((rows) => rows[0] ?? null);

      if (!sop) return null;

      const assets = await db
        .select()
        .from(sopAssets)
        .where(eq(sopAssets.sopId, id));

      return { ...sop, assets };
    },

    async list(companyId: string, filters?: { category?: string; status?: string }) {
      const conditions = [eq(companySops.companyId, companyId)];
      if (filters?.category) {
        conditions.push(eq(companySops.category, filters.category));
      }
      if (filters?.status) {
        conditions.push(eq(companySops.status, filters.status));
      }
      return db
        .select()
        .from(companySops)
        .where(and(...conditions));
    },

    async update(
      id: string,
      data: {
        name?: string;
        description?: string | null;
        category?: string | null;
        status?: string;
        markdownBody?: string;
      },
    ) {
      return db
        .update(companySops)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(companySops.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    async remove(id: string) {
      // Assets cascade-delete via FK
      return db
        .delete(companySops)
        .where(eq(companySops.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    async listAssets(sopId: string) {
      return db
        .select()
        .from(sopAssets)
        .where(eq(sopAssets.sopId, sopId));
    },

    async getAssetById(assetId: string) {
      return db
        .select()
        .from(sopAssets)
        .where(eq(sopAssets.id, assetId))
        .then((rows) => rows[0] ?? null);
    },

    /**
     * Resolve the full filesystem path for an asset.
     * Uses localPath if available, otherwise composes from SOP sourcePath + asset relativePath.
     */
    async resolveAssetPath(assetId: string): Promise<string | null> {
      const asset = await db
        .select()
        .from(sopAssets)
        .where(eq(sopAssets.id, assetId))
        .then((rows) => rows[0] ?? null);

      if (!asset) return null;

      if (asset.localPath) return asset.localPath;

      // Fall back to SOP sourcePath + relativePath
      const sop = await db
        .select()
        .from(companySops)
        .where(eq(companySops.id, asset.sopId))
        .then((rows) => rows[0] ?? null);

      if (!sop?.sourcePath) return null;
      return path.join(sop.sourcePath, asset.relativePath);
    },

    detectContentType(filePath: string): string {
      const ext = path.extname(filePath).toLowerCase();
      return CONTENT_TYPE_MAP[ext] ?? "application/octet-stream";
    },
  };
}
