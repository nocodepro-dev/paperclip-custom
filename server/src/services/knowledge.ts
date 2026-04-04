import { readdir, stat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { and, eq, ilike, or, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { knowledgeCollections, knowledgeEntries, knowledgeGroups } from "@paperclipai/db";
import type {
  KnowledgeEntryKind,
  KnowledgeRescanResult,
  KnowledgeManifest,
  KnowledgeCollectionManifest,
  KnowledgeGroupKind,
} from "@paperclipai/shared";

const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  ".nox",
  ".pytest_cache",
  ".next",
  ".nuxt",
  "dist",
  "build",
  ".DS_Store",
]);

const EXCLUDED_FILES = new Set([".DS_Store", "Thumbs.db", "Desktop.ini"]);

const CONTENT_TYPE_MAP: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".ts": "application/typescript",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".xml": "text/xml",
  ".csv": "text/csv",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

const MAX_MANIFEST_ENTRIES = 200;

function detectContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPE_MAP[ext] ?? "application/octet-stream";
}

function inferKind(relativePath: string, contentType: string): KnowledgeEntryKind {
  const lower = relativePath.toLowerCase();
  if (lower.includes("design-system") || lower.includes("design_system")) return "design_system";
  if (lower.includes("schema") || lower.includes("database")) return "schema";
  if (lower.includes("prd") || lower.includes("PRD")) return "document";
  if (lower.includes("brief")) return "brief";
  if (lower.includes("flow")) return "flow";
  if (lower.includes("sop")) return "sop";
  if (contentType.startsWith("image/")) return "screenshot";
  if (contentType.startsWith("text/") || contentType === "application/json") return "document";
  return "asset";
}

function deriveName(relativePath: string): string {
  const basename = path.basename(relativePath, path.extname(relativePath));
  return basename.replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
}

async function generateSummary(
  fullPath: string,
  contentType: string,
  byteSize: number,
): Promise<string | null> {
  try {
    if (contentType === "text/markdown" || contentType === "text/plain") {
      const content = await readFile(fullPath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
      const firstParagraph = lines[0] ?? null;
      if (firstParagraph) return firstParagraph.slice(0, 200);
    }
    if (contentType === "application/json" && byteSize < 10_000_000) {
      const content = await readFile(fullPath, "utf-8");
      const parsed = JSON.parse(content);
      if (typeof parsed === "object" && parsed !== null) {
        const keys = Object.keys(parsed).slice(0, 5);
        return `JSON file with ${Object.keys(parsed).length} top-level keys: ${keys.join(", ")}${Object.keys(parsed).length > 5 ? "..." : ""}`;
      }
    }
    if (contentType === "text/html") {
      const content = await readFile(fullPath, "utf-8");
      const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) return titleMatch[1].trim().slice(0, 200);
      const h1Match = content.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      if (h1Match) return h1Match[1].trim().slice(0, 200);
    }
    if (contentType.startsWith("image/")) {
      const sizeKB = Math.round(byteSize / 1024);
      return `${contentType.split("/")[1].toUpperCase()} image, ${sizeKB} KB`;
    }
  } catch {
    // summary generation is best-effort
  }
  return null;
}

async function computeSha256(fullPath: string): Promise<string> {
  const content = await readFile(fullPath);
  return createHash("sha256").update(content).digest("hex");
}

interface ScannedFile {
  relativePath: string;
  name: string;
  kind: KnowledgeEntryKind;
  contentType: string;
  byteSize: number;
  sha256: string | null;
  summary: string | null;
}

async function walkDirectory(
  rootPath: string,
  currentPath: string = "",
): Promise<ScannedFile[]> {
  const results: ScannedFile[] = [];
  const fullDir = currentPath ? path.join(rootPath, currentPath) : rootPath;

  let entries;
  try {
    entries = await readdir(fullDir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name) || EXCLUDED_FILES.has(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.name !== ".gitkeep") continue;

    const relativePath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
    const fullPath = path.join(rootPath, relativePath);

    if (entry.isDirectory()) {
      const subResults = await walkDirectory(rootPath, relativePath);
      results.push(...subResults);
    } else if (entry.isFile()) {
      try {
        const fileStat = await stat(fullPath);
        const contentType = detectContentType(entry.name);
        const kind = inferKind(relativePath, contentType);
        const isTextSmall = contentType.startsWith("text/") || contentType === "application/json";
        const sha256 =
          isTextSmall && fileStat.size < 10_000_000 ? await computeSha256(fullPath) : null;
        const summary = await generateSummary(fullPath, contentType, fileStat.size);

        results.push({
          relativePath,
          name: deriveName(relativePath),
          kind,
          contentType,
          byteSize: fileStat.size,
          sha256,
          summary,
        });
      } catch {
        // skip files we can't read
      }
    }
  }

  return results;
}

interface DetectedGroup {
  relativePath: string;
  name: string;
  kind: KnowledgeGroupKind;
  files: ScannedFile[];
  primaryIndex: number | null;
}

function cleanGroupName(folderName: string): string {
  // Remove timestamp suffixes like "(Mar 05, 2026 at 6-22 AM)"
  return folderName.replace(/\s*\([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+at\s+\d{1,2}-\d{2}\s+[AP]M\)\s*$/, "").trim();
}

function detectGroupKind(files: ScannedFile[], folderName: string): KnowledgeGroupKind {
  const hasScreenshotsSubfolder = files.some((f) => f.relativePath.includes("/screenshots/"));
  const hasMarkdown = files.some((f) => f.contentType === "text/markdown");
  if (hasMarkdown && hasScreenshotsSubfolder) return "flow";

  const lowerName = folderName.toLowerCase();
  if (lowerName.includes("design") && files.some((f) => f.contentType === "text/css" || f.contentType === "text/html")) {
    return "design_system";
  }

  const imageCount = files.filter((f) => f.contentType.startsWith("image/")).length;
  if (imageCount > files.length / 2 && !hasMarkdown) return "asset_bundle";

  return "document_set";
}

function detectPrimaryFile(files: ScannedFile[]): number | null {
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f.contentType !== "text/markdown") continue;
    const depth = f.relativePath.split("/").length;
    if (depth <= 2) return i;
  }

  let bestIdx: number | null = null;
  let bestSize = 0;
  for (let i = 0; i < files.length; i++) {
    if (files[i].contentType === "text/markdown" && files[i].byteSize > bestSize) {
      bestSize = files[i].byteSize;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function detectGroups(allFiles: ScannedFile[]): { groups: DetectedGroup[]; ungrouped: ScannedFile[] } {
  const folderFiles = new Map<string, ScannedFile[]>();
  const rootFiles: ScannedFile[] = [];

  for (const file of allFiles) {
    const parts = file.relativePath.split("/");
    if (parts.length === 1) {
      rootFiles.push(file);
    } else {
      const topFolder = parts[0];
      if (!folderFiles.has(topFolder)) folderFiles.set(topFolder, []);
      folderFiles.get(topFolder)!.push(file);
    }
  }

  const groups: DetectedGroup[] = [];
  const ungrouped: ScannedFile[] = [...rootFiles];

  for (const [folderName, files] of folderFiles) {
    if (files.length < 2) {
      ungrouped.push(...files);
      continue;
    }

    const kind = detectGroupKind(files, folderName);
    const primaryIndex = detectPrimaryFile(files);

    groups.push({
      relativePath: folderName,
      name: cleanGroupName(folderName),
      kind,
      files,
      primaryIndex,
    });
  }

  return { groups, ungrouped };
}

export function knowledgeService(db: Db) {
  return {
    async createCollection(
      companyId: string,
      data: {
        name: string;
        description?: string | null;
        sourceType?: string;
        sourcePath: string;
        projectId?: string | null;
        autoDiscover?: boolean;
      },
    ) {
      // Normalize path
      const sourcePath = data.sourcePath.replace(/\\/g, "/").replace(/\/+$/, "");

      // Validate path is accessible
      try {
        const s = await stat(sourcePath);
        if (!s.isDirectory()) throw new Error("Not a directory");
      } catch {
        throw new Error(`Source path is not accessible: ${sourcePath}`);
      }

      // Insert collection
      const [collection] = await db
        .insert(knowledgeCollections)
        .values({
          companyId,
          name: data.name,
          description: data.description ?? null,
          sourceType: data.sourceType ?? "local_path",
          sourcePath,
          projectId: data.projectId ?? null,
          autoDiscover: data.autoDiscover ?? true,
        })
        .returning();

      // Scan directory
      const files = await walkDirectory(sourcePath);

      // Detect groups from folder structure
      const { groups: detectedGroups, ungrouped } = detectGroups(files);

      // Insert ungrouped entries
      if (ungrouped.length > 0) {
        await db.insert(knowledgeEntries).values(
          ungrouped.map((f) => ({
            collectionId: collection.id,
            companyId,
            relativePath: f.relativePath,
            name: f.name,
            kind: f.kind,
            contentType: f.contentType,
            byteSize: f.byteSize,
            sha256: f.sha256,
            summary: f.summary,
            lastVerifiedAt: new Date(),
            groupId: null,
            groupRole: null,
          })),
        );
      }

      // Insert groups with their entries
      for (const group of detectedGroups) {
        const [groupRecord] = await db
          .insert(knowledgeGroups)
          .values({
            collectionId: collection.id,
            name: group.name,
            relativePath: group.relativePath,
            kind: group.kind,
            entryCount: group.files.length,
          })
          .returning();

        const insertedEntries = await db
          .insert(knowledgeEntries)
          .values(
            group.files.map((f, i) => ({
              collectionId: collection.id,
              companyId,
              relativePath: f.relativePath,
              name: f.name,
              kind: f.kind,
              contentType: f.contentType,
              byteSize: f.byteSize,
              sha256: f.sha256,
              summary: f.summary,
              lastVerifiedAt: new Date(),
              groupId: groupRecord.id,
              groupRole: (i === group.primaryIndex ? "primary" : "asset") as string,
            })),
          )
          .returning();

        const primaryEntry = group.primaryIndex !== null ? insertedEntries[group.primaryIndex] : null;
        if (primaryEntry) {
          await db
            .update(knowledgeGroups)
            .set({
              primaryEntryId: primaryEntry.id,
              description: primaryEntry.summary,
            })
            .where(eq(knowledgeGroups.id, groupRecord.id));
        }
      }

      // Update collection stats
      const totalBytes = files.reduce((sum, f) => sum + f.byteSize, 0);
      const [updated] = await db
        .update(knowledgeCollections)
        .set({
          entryCount: files.length,
          totalBytes,
          lastScannedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(knowledgeCollections.id, collection.id))
        .returning();

      return updated;
    },

    async listCollections(companyId: string, projectId?: string | null) {
      const conditions = [eq(knowledgeCollections.companyId, companyId)];
      if (projectId !== undefined) {
        if (projectId === null) {
          conditions.push(isNull(knowledgeCollections.projectId));
        } else {
          conditions.push(eq(knowledgeCollections.projectId, projectId));
        }
      }
      return db
        .select()
        .from(knowledgeCollections)
        .where(and(...conditions));
    },

    async getCollectionById(id: string) {
      return db
        .select()
        .from(knowledgeCollections)
        .where(eq(knowledgeCollections.id, id))
        .then((rows) => rows[0] ?? null);
    },

    async getCollectionDetail(companyId: string, collectionId: string) {
      const collection = await db
        .select()
        .from(knowledgeCollections)
        .where(
          and(
            eq(knowledgeCollections.id, collectionId),
            eq(knowledgeCollections.companyId, companyId),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (!collection) return null;

      const entries = await db
        .select()
        .from(knowledgeEntries)
        .where(eq(knowledgeEntries.collectionId, collectionId));

      const groups = await db
        .select()
        .from(knowledgeGroups)
        .where(eq(knowledgeGroups.collectionId, collectionId));

      return { ...collection, entries, groups };
    },

    async updateCollection(
      id: string,
      data: {
        name?: string;
        description?: string | null;
        autoDiscover?: boolean;
        status?: string;
      },
    ) {
      return db
        .update(knowledgeCollections)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(knowledgeCollections.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    async removeCollection(id: string) {
      // Entries cascade-delete via FK
      return db
        .delete(knowledgeCollections)
        .where(eq(knowledgeCollections.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    // ── Group methods ──────────────────────────────────────────────────

    async listGroups(collectionId: string) {
      return db
        .select()
        .from(knowledgeGroups)
        .where(eq(knowledgeGroups.collectionId, collectionId));
    },

    async getGroupById(groupId: string) {
      return db
        .select()
        .from(knowledgeGroups)
        .where(eq(knowledgeGroups.id, groupId))
        .then((rows) => rows[0] ?? null);
    },

    async getGroupDetail(groupId: string) {
      const group = await db
        .select()
        .from(knowledgeGroups)
        .where(eq(knowledgeGroups.id, groupId))
        .then((rows) => rows[0] ?? null);

      if (!group) return null;

      const entries = await db
        .select()
        .from(knowledgeEntries)
        .where(eq(knowledgeEntries.groupId, groupId));

      return { ...group, entries };
    },

    async getGroupContent(groupId: string) {
      const group = await db
        .select()
        .from(knowledgeGroups)
        .where(eq(knowledgeGroups.id, groupId))
        .then((rows) => rows[0] ?? null);

      if (!group) return null;

      const entries = await db
        .select()
        .from(knowledgeEntries)
        .where(eq(knowledgeEntries.groupId, groupId));

      const collection = await db
        .select()
        .from(knowledgeCollections)
        .where(eq(knowledgeCollections.id, group.collectionId))
        .then((rows) => rows[0] ?? null);

      if (!collection) return null;

      const primaryEntry = entries.find((e) => e.groupRole === "primary");
      const assetEntries = entries.filter((e) => e.groupRole === "asset");

      let primaryContent: { id: string; name: string; content: string } | null = null;
      if (primaryEntry) {
        try {
          const fullPath = path.join(collection.sourcePath, primaryEntry.relativePath);
          const content = await readFile(fullPath, "utf-8");
          primaryContent = { id: primaryEntry.id, name: primaryEntry.name, content };
        } catch {
          // primary file not readable
        }
      }

      const assets: Array<{
        id: string;
        name: string;
        relativePath: string;
        contentType: string;
        base64: string;
      }> = [];

      for (const asset of assetEntries) {
        try {
          const fullPath = path.join(collection.sourcePath, asset.relativePath);
          const buffer = await readFile(fullPath);
          assets.push({
            id: asset.id,
            name: asset.name,
            relativePath: asset.relativePath,
            contentType: asset.contentType,
            base64: buffer.toString("base64"),
          });
        } catch {
          // skip unreadable assets
        }
      }

      return {
        group: { id: group.id, name: group.name, kind: group.kind },
        primary: primaryContent,
        assets,
      };
    },

    async rescanCollection(collectionId: string): Promise<KnowledgeRescanResult> {
      const collection = await db
        .select()
        .from(knowledgeCollections)
        .where(eq(knowledgeCollections.id, collectionId))
        .then((rows) => rows[0] ?? null);

      if (!collection) throw new Error("Collection not found");

      const existingEntries = await db
        .select()
        .from(knowledgeEntries)
        .where(eq(knowledgeEntries.collectionId, collectionId));

      const existingMap = new Map(existingEntries.map((e) => [e.relativePath, e]));
      const scannedFiles = await walkDirectory(collection.sourcePath);
      const scannedPaths = new Set(scannedFiles.map((f) => f.relativePath));

      let added = 0;
      let changed = 0;
      let removed = 0;
      let unchanged = 0;

      // New or changed files
      for (const file of scannedFiles) {
        const existing = existingMap.get(file.relativePath);
        if (!existing) {
          await db.insert(knowledgeEntries).values({
            collectionId,
            companyId: collection.companyId,
            relativePath: file.relativePath,
            name: file.name,
            kind: file.kind,
            contentType: file.contentType,
            byteSize: file.byteSize,
            sha256: file.sha256,
            summary: file.summary,
            lastVerifiedAt: new Date(),
          });
          added++;
        } else if (
          existing.byteSize !== file.byteSize ||
          (file.sha256 && existing.sha256 !== file.sha256)
        ) {
          await db
            .update(knowledgeEntries)
            .set({
              name: file.name,
              kind: file.kind,
              contentType: file.contentType,
              byteSize: file.byteSize,
              sha256: file.sha256,
              summary: file.summary,
              lastVerifiedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(knowledgeEntries.id, existing.id));
          changed++;
        } else {
          await db
            .update(knowledgeEntries)
            .set({ lastVerifiedAt: new Date() })
            .where(eq(knowledgeEntries.id, existing.id));
          unchanged++;
        }
      }

      // Deleted files
      for (const existing of existingEntries) {
        if (!scannedPaths.has(existing.relativePath)) {
          await db.delete(knowledgeEntries).where(eq(knowledgeEntries.id, existing.id));
          removed++;
        }
      }

      // ── Reconcile groups ─────────────────────────────────────────────
      await db.delete(knowledgeGroups).where(eq(knowledgeGroups.collectionId, collectionId));

      const { groups: detectedGroups, ungrouped: ungroupedFiles } = detectGroups(scannedFiles);

      await db
        .update(knowledgeEntries)
        .set({ groupId: null, groupRole: null })
        .where(eq(knowledgeEntries.collectionId, collectionId));

      const currentEntries = await db
        .select()
        .from(knowledgeEntries)
        .where(eq(knowledgeEntries.collectionId, collectionId));
      const entryByPath = new Map(currentEntries.map((e) => [e.relativePath, e]));

      for (const group of detectedGroups) {
        const [groupRecord] = await db
          .insert(knowledgeGroups)
          .values({
            collectionId,
            name: group.name,
            relativePath: group.relativePath,
            kind: group.kind,
            entryCount: group.files.length,
          })
          .returning();

        let primaryEntryId: string | null = null;
        let primarySummary: string | null = null;

        for (let i = 0; i < group.files.length; i++) {
          const entry = entryByPath.get(group.files[i].relativePath);
          if (!entry) continue;

          const role = i === group.primaryIndex ? "primary" : "asset";
          await db
            .update(knowledgeEntries)
            .set({ groupId: groupRecord.id, groupRole: role })
            .where(eq(knowledgeEntries.id, entry.id));

          if (role === "primary") {
            primaryEntryId = entry.id;
            primarySummary = entry.summary;
          }
        }

        if (primaryEntryId) {
          await db
            .update(knowledgeGroups)
            .set({ primaryEntryId, description: primarySummary })
            .where(eq(knowledgeGroups.id, groupRecord.id));
        }
      }

      // Update collection stats
      const totalEntries = added + changed + unchanged;
      const totalBytes = scannedFiles.reduce((sum, f) => sum + f.byteSize, 0);
      await db
        .update(knowledgeCollections)
        .set({
          entryCount: totalEntries,
          totalBytes,
          lastScannedAt: new Date(),
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(knowledgeCollections.id, collectionId));

      return { added, changed, removed, unchanged };
    },

    async getEntryById(id: string) {
      return db
        .select()
        .from(knowledgeEntries)
        .where(eq(knowledgeEntries.id, id))
        .then((rows) => rows[0] ?? null);
    },

    async updateEntry(
      id: string,
      data: { name?: string; kind?: string; summary?: string | null },
    ) {
      return db
        .update(knowledgeEntries)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(knowledgeEntries.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    async resolveEntryContentPath(entryId: string): Promise<string | null> {
      const entry = await db
        .select({
          relativePath: knowledgeEntries.relativePath,
          sourcePath: knowledgeCollections.sourcePath,
        })
        .from(knowledgeEntries)
        .innerJoin(
          knowledgeCollections,
          eq(knowledgeEntries.collectionId, knowledgeCollections.id),
        )
        .where(eq(knowledgeEntries.id, entryId))
        .then((rows) => rows[0] ?? null);

      if (!entry) return null;
      return path.join(entry.sourcePath, entry.relativePath);
    },

    async searchEntries(
      companyId: string,
      query: string,
      opts?: { projectId?: string; kind?: string },
    ) {
      const conditions = [eq(knowledgeEntries.companyId, companyId)];

      if (opts?.kind) {
        conditions.push(eq(knowledgeEntries.kind, opts.kind));
      }

      const pattern = `%${query}%`;
      conditions.push(
        or(
          ilike(knowledgeEntries.name, pattern),
          ilike(knowledgeEntries.summary, pattern),
          ilike(knowledgeEntries.relativePath, pattern),
        )!,
      );

      let results = await db
        .select({
          entry: knowledgeEntries,
          collectionName: knowledgeCollections.name,
          collectionProjectId: knowledgeCollections.projectId,
        })
        .from(knowledgeEntries)
        .innerJoin(
          knowledgeCollections,
          eq(knowledgeEntries.collectionId, knowledgeCollections.id),
        )
        .where(and(...conditions));

      // Filter by project: include company-wide + matching project
      if (opts?.projectId) {
        results = results.filter(
          (r) => r.collectionProjectId === null || r.collectionProjectId === opts.projectId,
        );
      }

      return results.map((r) => ({
        ...r.entry,
        collectionName: r.collectionName,
      }));
    },

    async buildManifestForAgent(
      companyId: string,
      projectId?: string | null,
    ): Promise<KnowledgeManifest> {
      // Get company-wide collections
      const companyCollections = await db
        .select()
        .from(knowledgeCollections)
        .where(
          and(
            eq(knowledgeCollections.companyId, companyId),
            isNull(knowledgeCollections.projectId),
            eq(knowledgeCollections.status, "active"),
          ),
        );

      // Get project-specific collections
      const projectCollections = projectId
        ? await db
            .select()
            .from(knowledgeCollections)
            .where(
              and(
                eq(knowledgeCollections.companyId, companyId),
                eq(knowledgeCollections.projectId, projectId),
                eq(knowledgeCollections.status, "active"),
              ),
            )
        : [];

      const buildCollectionManifest = async (
        collection: typeof knowledgeCollections.$inferSelect,
      ): Promise<KnowledgeCollectionManifest> => {
        const entries = await db
          .select()
          .from(knowledgeEntries)
          .where(eq(knowledgeEntries.collectionId, collection.id));

        const groups = await db
          .select()
          .from(knowledgeGroups)
          .where(eq(knowledgeGroups.collectionId, collection.id));

        const mapEntry = (e: typeof knowledgeEntries.$inferSelect) => ({
          id: e.id,
          name: e.name,
          kind: e.kind as KnowledgeEntryKind,
          relativePath: e.relativePath,
          summary: e.summary,
          contentType: e.contentType,
          byteSize: Number(e.byteSize),
        });

        const groupManifests = groups.map((g) => {
          const groupEntries = entries.filter((e) => e.groupId === g.id);
          const primary = groupEntries.find((e) => e.groupRole === "primary");
          return {
            id: g.id,
            name: g.name,
            kind: g.kind as KnowledgeGroupKind,
            entryCount: groupEntries.length,
            primarySummary: primary?.summary ?? g.description,
            entries: groupEntries.slice(0, 50).map(mapEntry),
          };
        });

        const ungroupedEntries = entries
          .filter((e) => !e.groupId)
          .slice(0, MAX_MANIFEST_ENTRIES)
          .map(mapEntry);

        return {
          id: collection.id,
          name: collection.name,
          description: collection.description,
          groups: groupManifests,
          ungroupedEntries,
        };
      };

      return {
        companyCollections: await Promise.all(companyCollections.map(buildCollectionManifest)),
        projectCollections: await Promise.all(projectCollections.map(buildCollectionManifest)),
      };
    },

    async listEntries(collectionId: string, kind?: string) {
      const conditions = [eq(knowledgeEntries.collectionId, collectionId)];
      if (kind) conditions.push(eq(knowledgeEntries.kind, kind));
      return db
        .select()
        .from(knowledgeEntries)
        .where(and(...conditions));
    },
  };
}
