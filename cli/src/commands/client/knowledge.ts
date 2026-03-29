import { Command } from "commander";
import pc from "picocolors";
import type { BaseClientOptions } from "./common.js";
import {
  addCommonClientOptions,
  formatInlineRecord,
  handleCommandError,
  printOutput,
  resolveCommandContext,
} from "./common.js";

interface KnowledgeCollection {
  id: string;
  companyId: string;
  projectId: string | null;
  name: string;
  description: string | null;
  sourceType: string;
  sourcePath: string;
  entryCount: number;
  totalBytes: number;
  status: string;
  lastScannedAt: string | null;
}

interface KnowledgeEntry {
  id: string;
  relativePath: string;
  name: string;
  kind: string;
  contentType: string;
  byteSize: number;
  summary: string | null;
}

interface KnowledgeScanOptions extends BaseClientOptions {
  companyId: string;
  projectId?: string;
  name: string;
  description?: string;
}

interface KnowledgeListOptions extends BaseClientOptions {
  companyId: string;
  projectId?: string;
}

interface KnowledgeEntriesOptions extends BaseClientOptions {
  kind?: string;
}

interface KnowledgeSearchOptions extends BaseClientOptions {
  companyId: string;
  projectId?: string;
  kind?: string;
}

interface KnowledgeRemoveOptions extends BaseClientOptions {
  yes?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function registerKnowledgeCommands(program: Command): void {
  const knowledge = program.command("knowledge").description("Knowledge base operations");

  // knowledge scan <path>
  addCommonClientOptions(
    knowledge
      .command("scan")
      .description("Scan a directory and create a knowledge collection")
      .argument("<path>", "Directory path to scan")
      .requiredOption("-C, --company-id <id>", "Company ID")
      .requiredOption("--name <name>", "Collection name")
      .option("--project-id <id>", "Project ID (omit for company-wide)")
      .option("--description <text>", "Collection description")
      .action(async (dirPath: string, opts: KnowledgeScanOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const companyId = opts.companyId || ctx.companyId;
          if (!companyId) {
            console.error(pc.red("Company ID required. Use -C or set in context."));
            process.exit(1);
          }

          const body = {
            name: opts.name,
            description: opts.description || null,
            sourceType: "local_path",
            sourcePath: dirPath,
            projectId: opts.projectId || null,
          };

          const result = await ctx.api.post<KnowledgeCollection>(
            `/api/companies/${companyId}/knowledge/collections`,
            body,
          );

          if (!result) {
            console.error(pc.red("Failed to create collection."));
            process.exit(1);
          }

          if (ctx.json) {
            printOutput(result, { json: true });
            return;
          }

          console.log(pc.green(`✓ Collection "${result.name}" created`));
          console.log(`  ID: ${result.id}`);
          console.log(`  Source: ${result.sourcePath}`);
          console.log(`  Entries: ${result.entryCount}`);
          console.log(`  Total size: ${formatBytes(result.totalBytes)}`);
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeCompany: false },
  );

  // knowledge list
  addCommonClientOptions(
    knowledge
      .command("list")
      .description("List knowledge collections")
      .requiredOption("-C, --company-id <id>", "Company ID")
      .option("--project-id <id>", "Filter by project ID")
      .action(async (opts: KnowledgeListOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const companyId = opts.companyId || ctx.companyId;
          if (!companyId) {
            console.error(pc.red("Company ID required."));
            process.exit(1);
          }

          const params = new URLSearchParams();
          if (opts.projectId) params.set("projectId", opts.projectId);
          const query = params.toString();
          const path = `/api/companies/${companyId}/knowledge/collections${query ? `?${query}` : ""}`;
          const rows = (await ctx.api.get<KnowledgeCollection[]>(path)) ?? [];

          if (ctx.json) {
            printOutput(rows, { json: true });
            return;
          }

          if (rows.length === 0) {
            console.log(pc.dim("No knowledge collections found."));
            return;
          }

          for (const row of rows) {
            console.log(
              formatInlineRecord({
                id: row.id,
                name: row.name,
                source: row.sourcePath,
                entries: row.entryCount,
                size: formatBytes(row.totalBytes),
                status: row.status,
                project: row.projectId ?? "company-wide",
              }),
            );
          }
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeCompany: false },
  );

  // knowledge entries <collection-id>
  addCommonClientOptions(
    knowledge
      .command("entries")
      .description("List entries in a knowledge collection")
      .argument("<collectionId>", "Collection ID")
      .option("--kind <kind>", "Filter by kind (document, schema, design_system, etc.)")
      .action(async (collectionId: string, opts: KnowledgeEntriesOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const detail = await ctx.api.get<{ entries: KnowledgeEntry[] }>(
            `/api/knowledge/collections/${collectionId}`,
          );

          if (!detail) {
            console.error(pc.red("Collection not found."));
            process.exit(1);
          }

          let entries = detail.entries;
          if (opts.kind) {
            entries = entries.filter((e) => e.kind === opts.kind);
          }

          if (ctx.json) {
            printOutput(entries, { json: true });
            return;
          }

          if (entries.length === 0) {
            console.log(pc.dim("No entries found."));
            return;
          }

          for (const entry of entries) {
            console.log(
              formatInlineRecord({
                id: entry.id,
                kind: entry.kind,
                name: entry.name,
                path: entry.relativePath,
                size: formatBytes(entry.byteSize),
                summary: entry.summary ? entry.summary.slice(0, 80) : "",
              }),
            );
          }
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  // knowledge read <entry-id>
  addCommonClientOptions(
    knowledge
      .command("read")
      .description("Read a knowledge entry's metadata and location")
      .argument("<entryId>", "Entry ID")
      .action(async (entryId: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const entry = await ctx.api.get<KnowledgeEntry & { collectionId: string }>(
            `/api/knowledge/entries/${entryId}`,
          );
          if (!entry) {
            console.error(pc.red("Entry not found."));
            process.exit(1);
          }
          if (ctx.json) {
            printOutput(entry, { json: true });
            return;
          }
          console.log(formatInlineRecord({
            id: entry.id,
            name: entry.name,
            kind: entry.kind,
            path: entry.relativePath,
            contentType: entry.contentType,
            size: formatBytes(entry.byteSize),
            summary: entry.summary ?? "",
          }));
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  // knowledge rescan <collection-id>
  addCommonClientOptions(
    knowledge
      .command("rescan")
      .description("Rescan a collection for new, changed, or deleted files")
      .argument("<collectionId>", "Collection ID")
      .action(async (collectionId: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const result = await ctx.api.post<{
            added: number;
            changed: number;
            removed: number;
            unchanged: number;
          }>(`/api/knowledge/collections/${collectionId}/rescan`, {});

          if (!result) {
            console.error(pc.red("Rescan failed."));
            process.exit(1);
          }

          if (ctx.json) {
            printOutput(result, { json: true });
            return;
          }

          console.log(pc.green("✓ Rescan complete"));
          console.log(`  Added: ${result.added}`);
          console.log(`  Changed: ${result.changed}`);
          console.log(`  Removed: ${result.removed}`);
          console.log(`  Unchanged: ${result.unchanged}`);
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  // knowledge search <query>
  addCommonClientOptions(
    knowledge
      .command("search")
      .description("Search knowledge entries")
      .argument("<query>", "Search query")
      .requiredOption("-C, --company-id <id>", "Company ID")
      .option("--project-id <id>", "Filter by project ID")
      .option("--kind <kind>", "Filter by kind")
      .action(async (query: string, opts: KnowledgeSearchOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const companyId = opts.companyId || ctx.companyId;
          if (!companyId) {
            console.error(pc.red("Company ID required."));
            process.exit(1);
          }

          const params = new URLSearchParams({ q: query });
          if (opts.projectId) params.set("projectId", opts.projectId);
          if (opts.kind) params.set("kind", opts.kind);
          const path = `/api/companies/${companyId}/knowledge/search?${params}`;
          const results = (await ctx.api.get<Array<KnowledgeEntry & { collectionName: string }>>(path)) ?? [];

          if (ctx.json) {
            printOutput(results, { json: true });
            return;
          }

          if (results.length === 0) {
            console.log(pc.dim(`No results for "${query}".`));
            return;
          }

          for (const entry of results) {
            console.log(
              formatInlineRecord({
                id: entry.id,
                kind: entry.kind,
                name: entry.name,
                collection: entry.collectionName,
                path: entry.relativePath,
                summary: entry.summary ? entry.summary.slice(0, 60) : "",
              }),
            );
          }
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeCompany: false },
  );

  // knowledge remove <collection-id>
  addCommonClientOptions(
    knowledge
      .command("remove")
      .description("Remove a knowledge collection (index only, files untouched)")
      .argument("<collectionId>", "Collection ID")
      .option("-y, --yes", "Skip confirmation", false)
      .action(async (collectionId: string, opts: KnowledgeRemoveOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          if (!opts.yes) {
            console.log(pc.yellow("This will remove the knowledge index. Files on disk will NOT be deleted."));
            console.log(pc.yellow("Use --yes to skip this confirmation."));
            process.exit(0);
          }
          await ctx.api.delete(`/api/knowledge/collections/${collectionId}`);
          console.log(pc.green("✓ Collection removed (files untouched)."));
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
}
