import { Command } from "commander";
import pc from "picocolors";
import type { BaseClientOptions } from "./common.js";
import {
  addCommonClientOptions,
  handleCommandError,
  printOutput,
  resolveCommandContext,
} from "./common.js";

interface WorkspaceStatus {
  workspaceDir: string;
  hasRemote: boolean;
  remoteUrl: string | null;
  pendingChanges: number;
  lastCommit: { sha: string; message: string; date: string } | null;
}

interface WorkspaceExportStats {
  workspaceDir: string;
  companies: number;
  activityLogEntries: number;
  costEvents: number;
  heartbeatRuns: number;
  warnings: string[];
}

interface SyncResponse {
  ok: boolean;
  exported: WorkspaceExportStats;
  committed: boolean;
  commitSha: string | null;
}

interface CloneResponse {
  ok: boolean;
  imported: {
    companies: number;
    activityLogEntries: number;
    costEvents: number;
    heartbeatRuns: number;
    warnings: string[];
  };
}

interface InitOpts extends BaseClientOptions {
  branch: string;
}

interface CloneOpts extends BaseClientOptions {
  branch: string;
}

export function registerWorkspaceCommands(program: Command): void {
  const ws = program.command("workspace").description("Workspace export/import and Git sync operations");

  // workspace status
  addCommonClientOptions(
    ws.command("status")
      .description("Show workspace Git status and last sync info")
      .action(async (opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const result = await ctx.api.get<WorkspaceStatus>("/api/workspace/status");
          if (!result) {
            console.error(pc.red("Failed to get workspace status"));
            process.exit(1);
          }
          if (ctx.json) { printOutput(result, { json: true }); return; }
          console.log(`Workspace dir: ${result.workspaceDir}`);
          console.log(`Has remote: ${result.hasRemote ? pc.green("yes") : pc.yellow("no")}`);
          if (result.remoteUrl) console.log(`Remote: ${result.remoteUrl}`);
          console.log(`Pending changes: ${result.pendingChanges}`);
          if (result.lastCommit) {
            console.log(`Last commit: ${result.lastCommit.sha.slice(0, 7)} — ${result.lastCommit.message}`);
            console.log(`  at ${result.lastCommit.date}`);
          } else {
            console.log(pc.dim("No commits yet."));
          }
        } catch (err) { handleCommandError(err); }
      }),
    { includeCompany: false },
  );

  // workspace init <remoteUrl>
  addCommonClientOptions(
    ws.command("init")
      .description("Initialize the workspace directory and link it to a Git remote")
      .argument("<remoteUrl>", "Git remote URL (e.g. https://github.com/user/repo.git)")
      .option("--branch <branch>", "Branch name", "main")
      .action(async (remoteUrl: string, opts: InitOpts) => {
        try {
          const ctx = resolveCommandContext(opts);
          const result = await ctx.api.post<{ ok: boolean; workspaceDir: string; remoteUrl: string; branch: string }>(
            "/api/workspace/init",
            { remoteUrl, branch: opts.branch },
          );
          if (!result) {
            console.error(pc.red("Init failed"));
            process.exit(1);
          }
          if (ctx.json) { printOutput(result, { json: true }); return; }
          console.log(pc.green(`✓ Workspace initialized at ${result.workspaceDir}`));
          console.log(`  Remote: ${result.remoteUrl}`);
          console.log(`  Branch: ${result.branch}`);
        } catch (err) { handleCommandError(err); }
      }),
    { includeCompany: false },
  );

  // workspace sync
  addCommonClientOptions(
    ws.command("sync")
      .description("Export, commit, and push the workspace to the configured Git remote")
      .action(async (opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          if (!ctx.json) console.log(pc.dim("Exporting workspace..."));
          const result = await ctx.api.post<SyncResponse>("/api/workspace/sync", {});
          if (!result) {
            console.error(pc.red("Sync failed"));
            process.exit(1);
          }
          if (ctx.json) { printOutput(result, { json: true }); return; }
          console.log(pc.green(`✓ Exported ${result.exported.companies} companies`));
          if (result.committed) {
            console.log(pc.green(`✓ Committed and pushed${result.commitSha ? ` (sha: ${result.commitSha.slice(0, 7)})` : ""}`));
          } else {
            console.log(pc.dim("No changes to commit."));
          }
          if (result.exported.warnings.length > 0) {
            console.log(pc.yellow(`\nWarnings:`));
            for (const w of result.exported.warnings) console.log(pc.yellow(`  - ${w}`));
          }
        } catch (err) { handleCommandError(err); }
      }),
    { includeCompany: false },
  );

  // workspace clone <remoteUrl>
  addCommonClientOptions(
    ws.command("clone")
      .description("Clone a workspace from Git and import it into this Paperclip instance")
      .argument("<remoteUrl>", "Git remote URL to clone")
      .option("--branch <branch>", "Branch to clone", "main")
      .action(async (remoteUrl: string, opts: CloneOpts) => {
        try {
          const ctx = resolveCommandContext(opts);
          if (!ctx.json) console.log(pc.dim("Cloning workspace..."));
          const result = await ctx.api.post<CloneResponse>("/api/workspace/clone", {
            remoteUrl,
            branch: opts.branch,
          });
          if (!result) {
            console.error(pc.red("Clone failed"));
            process.exit(1);
          }
          if (ctx.json) { printOutput(result, { json: true }); return; }
          console.log(pc.green(`✓ Imported ${result.imported.companies} companies`));
          console.log(`  Activity entries: ${result.imported.activityLogEntries}`);
          console.log(`  Cost events: ${result.imported.costEvents}`);
          console.log(`  Heartbeat runs: ${result.imported.heartbeatRuns}`);
          if (result.imported.warnings.length > 0) {
            console.log(pc.yellow(`\nWarnings:`));
            for (const w of result.imported.warnings) console.log(pc.yellow(`  - ${w}`));
          }
        } catch (err) { handleCommandError(err); }
      }),
    { includeCompany: false },
  );

  // workspace pull
  addCommonClientOptions(
    ws.command("pull")
      .description("Pull workspace changes from Git and apply to the DB")
      .action(async (opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const result = await ctx.api.post<CloneResponse>("/api/workspace/pull", {});
          if (!result) {
            console.error(pc.red("Pull failed"));
            process.exit(1);
          }
          if (ctx.json) { printOutput(result, { json: true }); return; }
          console.log(pc.green(`✓ Pull complete: ${result.imported.companies} companies applied`));
          if (result.imported.warnings.length > 0) {
            console.log(pc.yellow(`\nWarnings:`));
            for (const w of result.imported.warnings) console.log(pc.yellow(`  - ${w}`));
          }
        } catch (err) { handleCommandError(err); }
      }),
    { includeCompany: false },
  );
}
