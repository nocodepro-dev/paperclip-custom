import { Command } from "commander";
import pc from "picocolors";
import type { BaseClientOptions } from "./common.js";
import {
  addCommonClientOptions,
  handleCommandError,
  printOutput,
  resolveCommandContext,
} from "./common.js";

interface SkillToolRequirement {
  toolId: string;
  name: string;
  status: "installed" | "available" | "unavailable";
  installCommand: string | null;
  configHints: string[];
  stepsUsing: number[];
}

interface SkillRequirementsReport {
  skillId: string;
  skillName: string;
  requirements: SkillToolRequirement[];
  satisfied: number;
  total: number;
  allSatisfied: boolean;
}

interface EquipPlan {
  skillId: string;
  skillName: string;
  allSatisfied: boolean;
  missing: Array<{
    step: number;
    toolId: string;
    name: string;
    installCommand: string | null;
    configHints: string[];
  }>;
  summary: string;
}

interface SkillCheckOptions extends BaseClientOptions {
  companyId: string;
}

interface SkillEquipOptions extends BaseClientOptions {
  companyId: string;
}

export function registerSkillEquipCommands(program: Command): void {
  const skill = program.command("skill").description("Skill tool management commands");

  // skill check <skill-id>
  addCommonClientOptions(
    skill
      .command("check")
      .description("Check a skill's tool requirements and availability")
      .argument("<skillId>", "Skill ID")
      .requiredOption("-C, --company-id <id>", "Company ID")
      .action(async (skillId: string, opts: SkillCheckOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const companyId = opts.companyId || ctx.companyId;
          if (!companyId) {
            console.error(pc.red("Company ID required. Use -C or set in context."));
            process.exit(1);
          }

          const report = await ctx.api.get<SkillRequirementsReport>(
            `/api/skills/${skillId}/requirements?companyId=${companyId}`,
          );

          if (!report) {
            console.error(pc.red("Skill not found or no requirements detected."));
            process.exit(1);
          }

          if (ctx.json) {
            printOutput(report, { json: true });
            return;
          }

          console.log(pc.bold(`Skill "${report.skillName}" tool requirements:`));
          console.log();

          if (report.requirements.length === 0) {
            console.log(pc.dim("  No external tool requirements detected."));
            return;
          }

          for (const req of report.requirements) {
            if (req.status === "installed") {
              console.log(`  ${pc.green("✓")} ${pc.bold(req.name)} — installed`);
            } else if (req.status === "available") {
              console.log(`  ${pc.red("✗")} ${pc.bold(req.name)} — not installed`);
              if (req.installCommand) {
                console.log(pc.dim(`     Install: ${req.installCommand}`));
              }
              if (req.configHints.length > 0) {
                console.log(pc.dim(`     Config: ${req.configHints[0]}`));
              }
            } else {
              console.log(`  ${pc.yellow("?")} ${pc.bold(req.name)} — no known MCP server`);
              if (req.configHints.length > 0) {
                console.log(pc.dim(`     ${req.configHints[0]}`));
              }
            }

            if (req.stepsUsing.length > 0) {
              console.log(pc.dim(`     Used in steps: ${req.stepsUsing.join(", ")}`));
            }
          }

          console.log();
          if (report.allSatisfied) {
            console.log(pc.green(`  All ${report.total} tools satisfied. Skill is ready to run.`));
          } else {
            console.log(
              `  ${pc.green(String(report.satisfied))} of ${report.total} tools satisfied.` +
              ` Run ${pc.dim(`skill equip ${skillId} -C ${companyId}`)} for install guidance.`,
            );
          }
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeCompany: false },
  );

  // skill equip <skill-id>
  addCommonClientOptions(
    skill
      .command("equip")
      .description("Show install commands for missing tools required by a skill")
      .argument("<skillId>", "Skill ID")
      .requiredOption("-C, --company-id <id>", "Company ID")
      .action(async (skillId: string, opts: SkillEquipOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const companyId = opts.companyId || ctx.companyId;
          if (!companyId) {
            console.error(pc.red("Company ID required. Use -C or set in context."));
            process.exit(1);
          }

          const plan = await ctx.api.post<EquipPlan>(
            `/api/skills/${skillId}/equip`,
            { companyId },
          );

          if (!plan) {
            console.error(pc.red("Failed to generate equip plan."));
            process.exit(1);
          }

          if (ctx.json) {
            printOutput(plan, { json: true });
            return;
          }

          console.log(pc.bold(`Equip plan for "${plan.skillName}":`));
          console.log();

          if (plan.allSatisfied) {
            console.log(pc.green("  All tools are installed. Skill is ready to run."));
            return;
          }

          for (const tool of plan.missing) {
            console.log(`  ${tool.step}. ${pc.bold(tool.name)}:`);
            if (tool.installCommand) {
              console.log(`     ${pc.cyan(tool.installCommand)}`);
            } else {
              console.log(pc.yellow("     No automated install available."));
            }
            for (const hint of tool.configHints) {
              console.log(pc.dim(`     Config: ${hint}`));
            }
            console.log();
          }

          console.log(pc.dim("  No automatic installation performed. Run the commands above manually."));
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeCompany: false },
  );
}
