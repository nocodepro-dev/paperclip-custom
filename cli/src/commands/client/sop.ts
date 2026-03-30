import { readFile, stat } from "node:fs/promises";
import path from "node:path";
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

interface CompanySop {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  category: string | null;
  sourceType: string;
  sourcePath: string | null;
  markdownBody: string;
  hasScreenshots: boolean;
  screenshotCount: number;
  status: string;
  generatedSkillId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SopAsset {
  id: string;
  sopId: string;
  relativePath: string;
  kind: string;
  stepNumber: number | null;
}

interface CompanySopDetail extends CompanySop {
  assets: SopAsset[];
}

interface SopUploadOptions extends BaseClientOptions {
  companyId: string;
  name: string;
  category?: string;
  description?: string;
  sourceType?: string;
}

interface SopListOptions extends BaseClientOptions {
  companyId: string;
  category?: string;
  status?: string;
}

interface SopRemoveOptions extends BaseClientOptions {
  yes?: boolean;
}

interface SopConvertOptions extends BaseClientOptions {
  auto?: boolean;
  review?: boolean;
}

interface SopConvertRejectOptions extends BaseClientOptions {
  feedback: string;
}

interface SOPStepAnalysis {
  stepNumber: number;
  humanAction: string;
  toolRequired: string | null;
  agentAction: string;
  automatable: boolean;
  requiresApproval: boolean;
  toolAvailable: boolean;
  fallback: string | null;
}

interface SOPConversionResult {
  sopId: string;
  status: string;
  stepAnalysis: SOPStepAnalysis[];
  draftSkillMarkdown: string | null;
  automationScore: number;
  generatedSkillId: string | null;
}

export function registerSopCommands(program: Command): void {
  const sop = program.command("sop").description("SOP management commands");

  // sop upload <path>
  addCommonClientOptions(
    sop
      .command("upload")
      .description("Upload an SOP from a markdown file or directory")
      .argument("<path>", "Path to a .md file or directory containing an SOP")
      .requiredOption("-C, --company-id <id>", "Company ID")
      .requiredOption("--name <name>", "SOP name")
      .option("--category <category>", "SOP category (e.g., finance, deployment, onboarding)")
      .option("--description <text>", "SOP description")
      .option("--source-type <type>", "Source type (upload, replaydoc_export, local_path)")
      .action(async (sopPath: string, opts: SopUploadOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const companyId = opts.companyId || ctx.companyId;
          if (!companyId) {
            console.error(pc.red("Company ID required. Use -C or set in context."));
            process.exit(1);
          }

          const resolvedPath = path.resolve(sopPath);
          const pathStat = await stat(resolvedPath);

          let body: Record<string, unknown>;

          if (pathStat.isDirectory()) {
            // Directory upload: server scans for markdown + screenshots
            body = {
              name: opts.name,
              description: opts.description || null,
              category: opts.category || null,
              sourceType: opts.sourceType || "local_path",
              sourcePath: resolvedPath.replace(/\\/g, "/"),
              markdownBody: "", // placeholder — server will override from directory scan
            };
          } else if (resolvedPath.toLowerCase().endsWith(".md")) {
            // Single markdown file upload
            const content = await readFile(resolvedPath, "utf-8");
            body = {
              name: opts.name,
              description: opts.description || null,
              category: opts.category || null,
              sourceType: opts.sourceType || "upload",
              markdownBody: content,
            };
          } else {
            console.error(pc.red("Path must be a .md file or a directory."));
            process.exit(1);
          }

          const result = await ctx.api.post<CompanySop>(
            `/api/companies/${companyId}/sops`,
            body,
          );

          if (!result) {
            console.error(pc.red("Failed to create SOP."));
            process.exit(1);
          }

          if (ctx.json) {
            printOutput(result, { json: true });
            return;
          }

          console.log(pc.green(`✓ SOP "${result.name}" created`));
          console.log(`  ID: ${result.id}`);
          console.log(`  Status: ${result.status}`);
          console.log(`  Source type: ${result.sourceType}`);
          if (result.hasScreenshots) {
            console.log(`  Screenshots: ${result.screenshotCount}`);
          }
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeCompany: false },
  );

  // sop list
  addCommonClientOptions(
    sop
      .command("list")
      .description("List SOPs for a company")
      .requiredOption("-C, --company-id <id>", "Company ID")
      .option("--category <category>", "Filter by category")
      .option("--status <status>", "Filter by status (draft, active, archived)")
      .action(async (opts: SopListOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const companyId = opts.companyId || ctx.companyId;
          if (!companyId) {
            console.error(pc.red("Company ID required."));
            process.exit(1);
          }

          const params = new URLSearchParams();
          if (opts.category) params.set("category", opts.category);
          if (opts.status) params.set("status", opts.status);
          const query = params.toString();
          const apiPath = `/api/companies/${companyId}/sops${query ? `?${query}` : ""}`;
          const rows = (await ctx.api.get<CompanySop[]>(apiPath)) ?? [];

          if (ctx.json) {
            printOutput(rows, { json: true });
            return;
          }

          if (rows.length === 0) {
            console.log(pc.dim("No SOPs found."));
            return;
          }

          for (const row of rows) {
            console.log(
              formatInlineRecord({
                id: row.id,
                name: row.name,
                status: row.status,
                category: row.category ?? "—",
                source: row.sourceType,
                screenshots: row.hasScreenshots ? row.screenshotCount : 0,
              }),
            );
          }
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeCompany: false },
  );

  // sop get <sop-id>
  addCommonClientOptions(
    sop
      .command("get")
      .description("Get SOP details")
      .argument("<sopId>", "SOP ID")
      .action(async (sopId: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const detail = await ctx.api.get<CompanySopDetail>(`/api/sops/${sopId}`);

          if (!detail) {
            console.error(pc.red("SOP not found."));
            process.exit(1);
          }

          if (ctx.json) {
            printOutput(detail, { json: true });
            return;
          }

          console.log(pc.bold(detail.name));
          console.log(`  ID: ${detail.id}`);
          console.log(`  Status: ${detail.status}`);
          console.log(`  Source type: ${detail.sourceType}`);
          if (detail.description) console.log(`  Description: ${detail.description}`);
          if (detail.category) console.log(`  Category: ${detail.category}`);
          if (detail.sourcePath) console.log(`  Source path: ${detail.sourcePath}`);
          console.log(`  Screenshots: ${detail.screenshotCount}`);

          if (detail.assets.length > 0) {
            console.log(pc.dim(`\n  Assets (${detail.assets.length}):`));
            for (const asset of detail.assets) {
              console.log(
                `    ${asset.kind} ${asset.relativePath}${asset.stepNumber != null ? ` (step ${asset.stepNumber})` : ""}`,
              );
            }
          }

          console.log(pc.dim("\n  --- Markdown Body (first 500 chars) ---"));
          console.log(`  ${detail.markdownBody.slice(0, 500)}`);
          if (detail.markdownBody.length > 500) {
            console.log(pc.dim(`  ... (${detail.markdownBody.length} chars total)`));
          }
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  // sop remove <sop-id>
  addCommonClientOptions(
    sop
      .command("remove")
      .description("Remove an SOP")
      .argument("<sopId>", "SOP ID")
      .option("-y, --yes", "Skip confirmation", false)
      .action(async (sopId: string, opts: SopRemoveOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          if (!opts.yes) {
            console.log(pc.yellow("This will permanently delete the SOP and its asset index."));
            console.log(pc.yellow("Use --yes to skip this confirmation."));
            process.exit(0);
          }
          await ctx.api.delete(`/api/sops/${sopId}`);
          console.log(pc.green("✓ SOP removed."));
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  // sop convert <sop-id>
  addCommonClientOptions(
    sop
      .command("convert")
      .description("Convert an SOP into an agent-executable SKILL.md")
      .argument("<sopId>", "SOP ID")
      .option("--auto", "Auto-approve the generated skill (skip review)")
      .option("--review", "Generate draft for review (default)")
      .action(async (sopId: string, opts: SopConvertOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const mode = opts.auto ? "auto" : "review";

          const result = await ctx.api.post<SOPConversionResult>(
            `/api/sops/${sopId}/convert`,
            { mode },
          );

          if (!result) {
            console.error(pc.red("Conversion failed."));
            process.exit(1);
          }

          if (ctx.json) {
            printOutput(result, { json: true });
            return;
          }

          console.log(pc.green(`✓ Conversion started (mode: ${mode})`));
          console.log(`  Automation score: ${result.automationScore}%`);
          console.log(`  Steps analyzed: ${result.stepAnalysis.length}`);
          console.log();

          // Step analysis summary
          for (const step of result.stepAnalysis) {
            const icon = step.automatable
              ? step.requiresApproval ? pc.yellow("⚠") : pc.green("✓")
              : pc.red("✗");
            const tool = step.toolRequired ? pc.dim(` [${step.toolRequired}]`) : "";
            console.log(`  ${icon} Step ${step.stepNumber}: ${step.humanAction.slice(0, 70)}${tool}`);
          }

          console.log();
          if (mode === "auto" && result.generatedSkillId) {
            console.log(pc.green(`  Skill created: ${result.generatedSkillId}`));
            console.log(pc.dim(`  Tip: Use /skill-creator to iteratively test and improve this skill.`));
          } else {
            console.log(pc.yellow(`  Draft ready for review.`));
            console.log(pc.dim(`  Approve: pnpm paperclipai sop convert-approve ${sopId}`));
            console.log(pc.dim(`  Reject:  pnpm paperclipai sop convert-reject ${sopId} --feedback "..."`));
          }
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  // sop convert-approve <sop-id>
  addCommonClientOptions(
    sop
      .command("convert-approve")
      .description("Approve a draft SOP conversion and create the skill")
      .argument("<sopId>", "SOP ID")
      .action(async (sopId: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const result = await ctx.api.post<{ skillId: string }>(
            `/api/sops/${sopId}/conversion/approve`,
            {},
          );

          if (!result) {
            console.error(pc.red("Approval failed."));
            process.exit(1);
          }

          if (ctx.json) {
            printOutput(result, { json: true });
            return;
          }

          console.log(pc.green(`✓ Conversion approved. Skill created.`));
          console.log(`  Skill ID: ${result.skillId}`);
          console.log(pc.dim(`  Tip: Use /skill-creator to iteratively test and improve this skill.`));
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  // sop convert-reject <sop-id>
  addCommonClientOptions(
    sop
      .command("convert-reject")
      .description("Reject a draft SOP conversion with feedback")
      .argument("<sopId>", "SOP ID")
      .requiredOption("--feedback <text>", "Reason for rejection")
      .action(async (sopId: string, opts: SopConvertRejectOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          await ctx.api.post(`/api/sops/${sopId}/conversion/reject`, {
            feedback: opts.feedback,
          });

          if (ctx.json) {
            printOutput({ ok: true }, { json: true });
            return;
          }

          console.log(pc.green(`✓ Conversion rejected. SOP reverted to active.`));
          console.log(pc.dim(`  Feedback: ${opts.feedback}`));
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
}
