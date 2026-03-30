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

interface PipelineTemplate {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  status: string;
  projectId: string | null;
  goalId: string | null;
  createdAt: string;
}

interface PipelineStage {
  id: string;
  title: string;
  stageOrder: number;
  parallelGroup: string | null;
  assigneeAgentId: string | null;
  requiredCapability: string | null;
  requiresApproval: boolean;
  priority: string;
}

interface PipelineTemplateDetail extends PipelineTemplate {
  stages: PipelineStage[];
  recentRuns: PipelineRun[];
}

interface PipelineRun {
  id: string;
  companyId: string;
  pipelineTemplateId: string;
  title: string;
  status: string;
  currentStageOrder: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface PipelineRunDetail extends PipelineRun {
  template: { id: string; title: string } | null;
  stageRuns: Array<{
    id: string;
    status: string;
    stage: { title: string; stageOrder: number };
    issue: { id: string; identifier: string | null; title: string; status: string } | null;
    resolvedAgent: { id: string; name: string } | null;
  }>;
}

interface PipelineCreateOptions extends BaseClientOptions {
  companyId: string;
  title: string;
  description?: string;
  projectId?: string;
  goalId?: string;
}

interface PipelineListOptions extends BaseClientOptions {
  companyId: string;
}

interface StageAddOptions extends BaseClientOptions {
  title: string;
  stageOrder: string;
  description?: string;
  assigneeAgentId?: string;
  requiredCapability?: string;
  parallelGroup?: string;
  requiresApproval?: boolean;
  priority?: string;
}

interface RunLaunchOptions extends BaseClientOptions {
  title?: string;
  input?: string;
  parentIssueId?: string;
}

interface RunListOptions extends BaseClientOptions {
  companyId: string;
  status?: string;
}

export function registerPipelineCommands(program: Command): void {
  const pipeline = program.command("pipeline").description("Pipeline management commands");

  // pipeline list
  addCommonClientOptions(
    pipeline
      .command("list")
      .description("List pipeline templates for a company")
      .requiredOption("-C, --company-id <id>", "Company ID")
      .action(async (opts: PipelineListOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const companyId = opts.companyId || ctx.companyId;
          if (!companyId) {
            console.error(pc.red("Company ID required."));
            process.exit(1);
          }
          const rows = (await ctx.api.get<PipelineTemplate[]>(
            `/api/companies/${companyId}/pipelines`,
          )) ?? [];
          if (ctx.json) { printOutput(rows, { json: true }); return; }
          if (rows.length === 0) { console.log(pc.dim("No pipelines found.")); return; }
          for (const row of rows) {
            console.log(formatInlineRecord({
              id: row.id,
              title: row.title,
              status: row.status,
            }));
          }
        } catch (err) { handleCommandError(err); }
      }),
    { includeCompany: false },
  );

  // pipeline get <id>
  addCommonClientOptions(
    pipeline
      .command("get")
      .description("Get pipeline template details with stages")
      .argument("<pipelineId>", "Pipeline template ID")
      .action(async (pipelineId: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const companyId = ctx.companyId;
          if (!companyId) {
            console.error(pc.red("Company ID required. Set in context."));
            process.exit(1);
          }
          const detail = await ctx.api.get<PipelineTemplateDetail>(
            `/api/companies/${companyId}/pipelines/${pipelineId}`,
          );
          if (!detail) { console.error(pc.red("Pipeline not found.")); process.exit(1); }
          if (ctx.json) { printOutput(detail, { json: true }); return; }

          console.log(pc.bold(detail.title));
          console.log(`  ID: ${detail.id}`);
          console.log(`  Status: ${detail.status}`);
          if (detail.description) console.log(`  Description: ${detail.description}`);

          if (detail.stages.length > 0) {
            console.log(pc.dim(`\n  Stages (${detail.stages.length}):`));
            for (const s of detail.stages) {
              const parallel = s.parallelGroup ? ` [parallel: ${s.parallelGroup}]` : "";
              const agent = s.assigneeAgentId ? ` → agent:${s.assigneeAgentId.slice(0, 8)}` : s.requiredCapability ? ` → cap:${s.requiredCapability}` : "";
              console.log(`    ${s.stageOrder}. ${s.title}${parallel}${agent}`);
            }
          }

          if (detail.recentRuns.length > 0) {
            console.log(pc.dim(`\n  Recent runs (${detail.recentRuns.length}):`));
            for (const r of detail.recentRuns) {
              console.log(`    ${r.id.slice(0, 8)} ${r.status} ${r.createdAt}`);
            }
          }
        } catch (err) { handleCommandError(err); }
      }),
  );

  // pipeline create
  addCommonClientOptions(
    pipeline
      .command("create")
      .description("Create a new pipeline template")
      .requiredOption("-C, --company-id <id>", "Company ID")
      .requiredOption("--title <title>", "Pipeline title")
      .option("--description <text>", "Pipeline description")
      .option("--project-id <id>", "Project ID")
      .option("--goal-id <id>", "Goal ID")
      .action(async (opts: PipelineCreateOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const companyId = opts.companyId || ctx.companyId;
          if (!companyId) {
            console.error(pc.red("Company ID required."));
            process.exit(1);
          }
          const result = await ctx.api.post<PipelineTemplate>(
            `/api/companies/${companyId}/pipelines`,
            {
              title: opts.title,
              description: opts.description || null,
              projectId: opts.projectId || null,
              goalId: opts.goalId || null,
            },
          );
          if (!result) { console.error(pc.red("Failed to create pipeline.")); process.exit(1); }
          if (ctx.json) { printOutput(result, { json: true }); return; }
          console.log(pc.green(`✓ Pipeline "${result.title}" created`));
          console.log(`  ID: ${result.id}`);
        } catch (err) { handleCommandError(err); }
      }),
    { includeCompany: false },
  );

  // pipeline stage subcommand group
  const stage = pipeline.command("stage").description("Pipeline stage management");

  // pipeline stage add <pipelineId>
  addCommonClientOptions(
    stage
      .command("add")
      .description("Add a stage to a pipeline")
      .argument("<pipelineId>", "Pipeline template ID")
      .requiredOption("--title <title>", "Stage title")
      .requiredOption("--stage-order <order>", "Stage order (0-based integer)")
      .option("--description <text>", "Stage description")
      .option("--assignee-agent-id <id>", "Agent ID to assign this stage to")
      .option("--required-capability <cap>", "Required agent capability")
      .option("--parallel-group <group>", "Parallel group name")
      .option("--requires-approval", "Require approval before execution", false)
      .option("--priority <priority>", "Issue priority (critical, high, medium, low)", "medium")
      .action(async (pipelineId: string, opts: StageAddOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const companyId = ctx.companyId;
          if (!companyId) {
            console.error(pc.red("Company ID required. Set in context."));
            process.exit(1);
          }
          const result = await ctx.api.post<PipelineStage>(
            `/api/companies/${companyId}/pipelines/${pipelineId}/stages`,
            {
              title: opts.title,
              description: opts.description || null,
              stageOrder: parseInt(opts.stageOrder, 10),
              assigneeAgentId: opts.assigneeAgentId || null,
              requiredCapability: opts.requiredCapability || null,
              parallelGroup: opts.parallelGroup || null,
              requiresApproval: opts.requiresApproval || false,
              priority: opts.priority || "medium",
            },
          );
          if (!result) { console.error(pc.red("Failed to add stage.")); process.exit(1); }
          if (ctx.json) { printOutput(result, { json: true }); return; }
          console.log(pc.green(`✓ Stage "${result.title}" added at order ${result.stageOrder}`));
          console.log(`  ID: ${result.id}`);
        } catch (err) { handleCommandError(err); }
      }),
  );

  // pipeline stage remove <stageId>
  addCommonClientOptions(
    stage
      .command("remove")
      .description("Remove a stage from a pipeline")
      .argument("<stageId>", "Stage ID")
      .action(async (stageId: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const companyId = ctx.companyId;
          if (!companyId) {
            console.error(pc.red("Company ID required. Set in context."));
            process.exit(1);
          }
          // We need the pipeline ID for the route, but the stage ID alone + company scope is enough
          // Use a generic delete that works with the stage ID
          await ctx.api.delete(`/api/companies/${companyId}/pipelines/_/stages/${stageId}`);
          console.log(pc.green("✓ Stage removed."));
        } catch (err) { handleCommandError(err); }
      }),
  );

  // pipeline run subcommand group
  const run = pipeline.command("run").description("Pipeline run management");

  // pipeline run launch <pipelineId>
  addCommonClientOptions(
    run
      .command("launch")
      .description("Launch a pipeline run")
      .argument("<pipelineId>", "Pipeline template ID")
      .option("--title <title>", "Run title (defaults to template title)")
      .option("--input <json>", "Input payload as JSON string")
      .option("--parent-issue-id <id>", "Parent issue ID for generated issues")
      .action(async (pipelineId: string, opts: RunLaunchOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const companyId = ctx.companyId;
          if (!companyId) {
            console.error(pc.red("Company ID required. Set in context."));
            process.exit(1);
          }
          const body: Record<string, unknown> = {};
          if (opts.title) body.title = opts.title;
          if (opts.input) body.inputPayload = JSON.parse(opts.input);
          if (opts.parentIssueId) body.parentIssueId = opts.parentIssueId;

          const result = await ctx.api.post<PipelineRun>(
            `/api/companies/${companyId}/pipelines/${pipelineId}/runs`,
            body,
          );
          if (!result) { console.error(pc.red("Failed to launch pipeline run.")); process.exit(1); }
          if (ctx.json) { printOutput(result, { json: true }); return; }
          console.log(pc.green(`✓ Pipeline run launched`));
          console.log(`  Run ID: ${result.id}`);
          console.log(`  Status: ${result.status}`);
        } catch (err) { handleCommandError(err); }
      }),
  );

  // pipeline run list
  addCommonClientOptions(
    run
      .command("list")
      .description("List pipeline runs")
      .requiredOption("-C, --company-id <id>", "Company ID")
      .option("--status <status>", "Filter by status")
      .action(async (opts: RunListOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const companyId = opts.companyId || ctx.companyId;
          if (!companyId) {
            console.error(pc.red("Company ID required."));
            process.exit(1);
          }
          const params = new URLSearchParams();
          if (opts.status) params.set("status", opts.status);
          const query = params.toString();
          const rows = (await ctx.api.get<PipelineRun[]>(
            `/api/companies/${companyId}/pipeline-runs${query ? `?${query}` : ""}`,
          )) ?? [];
          if (ctx.json) { printOutput(rows, { json: true }); return; }
          if (rows.length === 0) { console.log(pc.dim("No pipeline runs found.")); return; }
          for (const row of rows) {
            console.log(formatInlineRecord({
              id: row.id,
              title: row.title,
              status: row.status,
              stage: row.currentStageOrder ?? "—",
              started: row.startedAt ?? "—",
            }));
          }
        } catch (err) { handleCommandError(err); }
      }),
    { includeCompany: false },
  );

  // pipeline run get <runId>
  addCommonClientOptions(
    run
      .command("get")
      .description("Get pipeline run details with stage statuses")
      .argument("<runId>", "Pipeline run ID")
      .action(async (runId: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const companyId = ctx.companyId;
          if (!companyId) {
            console.error(pc.red("Company ID required. Set in context."));
            process.exit(1);
          }
          const detail = await ctx.api.get<PipelineRunDetail>(
            `/api/companies/${companyId}/pipeline-runs/${runId}`,
          );
          if (!detail) { console.error(pc.red("Pipeline run not found.")); process.exit(1); }
          if (ctx.json) { printOutput(detail, { json: true }); return; }

          console.log(pc.bold(detail.title));
          console.log(`  Run ID: ${detail.id}`);
          console.log(`  Status: ${detail.status}`);
          if (detail.template) console.log(`  Template: ${detail.template.title}`);
          if (detail.currentStageOrder != null) console.log(`  Current stage order: ${detail.currentStageOrder}`);

          if (detail.stageRuns.length > 0) {
            console.log(pc.dim(`\n  Stage runs:`));
            for (const sr of detail.stageRuns) {
              const agent = sr.resolvedAgent ? ` (${sr.resolvedAgent.name})` : "";
              const issue = sr.issue ? ` → issue:${sr.issue.identifier ?? sr.issue.id.slice(0, 8)} [${sr.issue.status}]` : "";
              console.log(`    ${sr.stage.stageOrder}. ${sr.stage.title} — ${sr.status}${agent}${issue}`);
            }
          }
        } catch (err) { handleCommandError(err); }
      }),
  );

  // pipeline run cancel <runId>
  addCommonClientOptions(
    run
      .command("cancel")
      .description("Cancel a pipeline run")
      .argument("<runId>", "Pipeline run ID")
      .action(async (runId: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const companyId = ctx.companyId;
          if (!companyId) {
            console.error(pc.red("Company ID required. Set in context."));
            process.exit(1);
          }
          await ctx.api.post(`/api/companies/${companyId}/pipeline-runs/${runId}/cancel`, {});
          console.log(pc.green("✓ Pipeline run cancelled."));
        } catch (err) { handleCommandError(err); }
      }),
  );
}
