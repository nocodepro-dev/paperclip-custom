import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  companySkills,
  issues,
  issueDocuments,
  issueWorkProducts,
  pipelineRuns,
  pipelineStageRuns,
  pipelineStages,
  pipelineTemplates,
} from "@paperclipai/db";
import type {
  CreatePipelineTemplate,
  UpdatePipelineTemplate,
  CreatePipelineStage,
  UpdatePipelineStage,
  LaunchPipelineRun,
  PipelineTemplateDetail,
  PipelineRunDetail,
  PipelineStageRunDetail,
} from "@paperclipai/shared";
import { notFound, unprocessable } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { issueService } from "./issues.js";
import { heartbeatService } from "./heartbeat.js";
import { queueIssueAssignmentWakeup } from "./issue-assignment-wakeup.js";

type Actor = { agentId?: string | null; userId?: string | null };

export function pipelineService(db: Db) {
  const issueSvc = issueService(db);
  const heartbeat = heartbeatService(db);

  // ---------------------------------------------------------------------------
  // Template CRUD
  // ---------------------------------------------------------------------------

  async function listTemplates(companyId: string) {
    return db
      .select()
      .from(pipelineTemplates)
      .where(
        and(
          eq(pipelineTemplates.companyId, companyId),
          eq(pipelineTemplates.status, "active"),
        ),
      )
      .orderBy(desc(pipelineTemplates.createdAt));
  }

  async function getTemplate(id: string) {
    const rows = await db.select().from(pipelineTemplates).where(eq(pipelineTemplates.id, id));
    return rows[0] ?? null;
  }

  async function getTemplateDetail(id: string): Promise<PipelineTemplateDetail | null> {
    const template = await getTemplate(id);
    if (!template) return null;
    const [stageRows, runRows] = await Promise.all([
      db
        .select()
        .from(pipelineStages)
        .where(eq(pipelineStages.pipelineTemplateId, id))
        .orderBy(asc(pipelineStages.stageOrder), asc(pipelineStages.createdAt)),
      db
        .select()
        .from(pipelineRuns)
        .where(eq(pipelineRuns.pipelineTemplateId, id))
        .orderBy(desc(pipelineRuns.createdAt))
        .limit(10),
    ]);
    return {
      ...template,
      stages: stageRows,
      recentRuns: runRows,
    };
  }

  async function createTemplate(companyId: string, input: CreatePipelineTemplate, actor: Actor) {
    const [created] = await db
      .insert(pipelineTemplates)
      .values({
        companyId,
        projectId: input.projectId ?? null,
        goalId: input.goalId ?? null,
        title: input.title,
        description: input.description ?? null,
        metadata: input.metadata ?? null,
        createdByAgentId: actor.agentId ?? null,
        createdByUserId: actor.userId ?? null,
      })
      .returning();
    return created;
  }

  async function updateTemplate(id: string, input: UpdatePipelineTemplate) {
    const [updated] = await db
      .update(pipelineTemplates)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(pipelineTemplates.id, id))
      .returning();
    return updated ?? null;
  }

  async function deleteTemplate(id: string) {
    const [updated] = await db
      .update(pipelineTemplates)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(pipelineTemplates.id, id))
      .returning();
    return updated ?? null;
  }

  // ---------------------------------------------------------------------------
  // Stage CRUD
  // ---------------------------------------------------------------------------

  async function listStages(templateId: string) {
    return db
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineTemplateId, templateId))
      .orderBy(asc(pipelineStages.stageOrder), asc(pipelineStages.createdAt));
  }

  async function getStage(id: string) {
    const rows = await db.select().from(pipelineStages).where(eq(pipelineStages.id, id));
    return rows[0] ?? null;
  }

  async function createStage(templateId: string, companyId: string, input: CreatePipelineStage) {
    const [created] = await db
      .insert(pipelineStages)
      .values({
        companyId,
        pipelineTemplateId: templateId,
        title: input.title,
        description: input.description ?? null,
        stageOrder: input.stageOrder,
        parallelGroup: input.parallelGroup ?? null,
        loopConfig: input.loopConfig ?? null,
        assigneeAgentId: input.assigneeAgentId ?? null,
        requiredCapability: input.requiredCapability ?? null,
        priority: input.priority ?? "medium",
        requiresApproval: input.requiresApproval ?? false,
        timeoutMinutes: input.timeoutMinutes ?? null,
        suggestedSkillId: input.suggestedSkillId ?? null,
        stageConfig: input.stageConfig ?? null,
      })
      .returning();
    return created;
  }

  async function updateStage(id: string, input: UpdatePipelineStage) {
    const [updated] = await db
      .update(pipelineStages)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(pipelineStages.id, id))
      .returning();
    return updated ?? null;
  }

  async function deleteStage(id: string) {
    const [deleted] = await db
      .delete(pipelineStages)
      .where(eq(pipelineStages.id, id))
      .returning();
    return deleted ?? null;
  }

  async function reorderStages(templateId: string, stageIds: string[]) {
    for (let i = 0; i < stageIds.length; i++) {
      await db
        .update(pipelineStages)
        .set({ stageOrder: i, updatedAt: new Date() })
        .where(
          and(
            eq(pipelineStages.id, stageIds[i]),
            eq(pipelineStages.pipelineTemplateId, templateId),
          ),
        );
    }
  }

  // ---------------------------------------------------------------------------
  // Run management
  // ---------------------------------------------------------------------------

  async function listRuns(companyId: string, filters?: { status?: string; pipelineTemplateId?: string }) {
    const conditions = [eq(pipelineRuns.companyId, companyId)];
    if (filters?.status) conditions.push(eq(pipelineRuns.status, filters.status));
    if (filters?.pipelineTemplateId) conditions.push(eq(pipelineRuns.pipelineTemplateId, filters.pipelineTemplateId));
    return db
      .select()
      .from(pipelineRuns)
      .where(and(...conditions))
      .orderBy(desc(pipelineRuns.createdAt));
  }

  async function getRun(id: string) {
    const rows = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, id));
    return rows[0] ?? null;
  }

  async function getRunDetail(id: string): Promise<PipelineRunDetail | null> {
    const run = await getRun(id);
    if (!run) return null;

    const template = await getTemplate(run.pipelineTemplateId);
    const stageRunRows = await db
      .select()
      .from(pipelineStageRuns)
      .where(eq(pipelineStageRuns.pipelineRunId, id))
      .orderBy(asc(pipelineStageRuns.createdAt));

    const stageIds = [...new Set(stageRunRows.map((sr) => sr.pipelineStageId))];
    const stageMap = new Map<string, (typeof pipelineStages.$inferSelect)>();
    if (stageIds.length > 0) {
      const stageRows = await db
        .select()
        .from(pipelineStages)
        .where(inArray(pipelineStages.id, stageIds));
      for (const s of stageRows) stageMap.set(s.id, s);
    }

    const issueIds = stageRunRows.map((sr) => sr.issueId).filter(Boolean) as string[];
    const issueMap = new Map<string, { id: string; identifier: string | null; title: string; status: string; priority: string }>();
    if (issueIds.length > 0) {
      const issueRows = await db
        .select({
          id: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
          priority: issues.priority,
        })
        .from(issues)
        .where(inArray(issues.id, issueIds));
      for (const i of issueRows) issueMap.set(i.id, i);
    }

    const agentIds = stageRunRows.map((sr) => sr.resolvedAgentId).filter(Boolean) as string[];
    const agentMap = new Map<string, { id: string; name: string; role: string; title: string | null }>();
    if (agentIds.length > 0) {
      const agentRows = await db
        .select({
          id: agents.id,
          name: agents.name,
          role: agents.role,
          title: agents.title,
        })
        .from(agents)
        .where(inArray(agents.id, [...new Set(agentIds)]));
      for (const a of agentRows) agentMap.set(a.id, a);
    }

    const stageRuns: PipelineStageRunDetail[] = stageRunRows.map((sr) => ({
      ...sr,
      stage: stageMap.get(sr.pipelineStageId)!,
      issue: sr.issueId ? issueMap.get(sr.issueId) ?? null : null,
      resolvedAgent: sr.resolvedAgentId ? agentMap.get(sr.resolvedAgentId) ?? null : null,
    }));

    return {
      ...run,
      template: template ? { id: template.id, title: template.title } : null,
      stageRuns,
    };
  }

  // ---------------------------------------------------------------------------
  // Pipeline execution engine
  // ---------------------------------------------------------------------------

  async function resolveAgentForStage(companyId: string, stage: typeof pipelineStages.$inferSelect) {
    if (stage.assigneeAgentId) return stage.assigneeAgentId;
    if (stage.requiredCapability) {
      const rows = await db
        .select({ id: agents.id })
        .from(agents)
        .where(
          and(
            eq(agents.companyId, companyId),
            eq(agents.status, "active"),
            sql`${agents.capabilities} ILIKE ${"%" + stage.requiredCapability + "%"}`,
          ),
        )
        .limit(1);
      if (rows.length > 0) return rows[0].id;
    }
    return null;
  }

  async function launchRun(companyId: string, templateId: string, input: LaunchPipelineRun, actor: Actor) {
    const template = await getTemplate(templateId);
    if (!template) throw notFound("Pipeline template not found");
    if (template.status !== "active") throw unprocessable("Pipeline template is not active");
    if (template.companyId !== companyId) throw notFound("Pipeline template not found");

    const stages = await listStages(templateId);
    if (stages.length === 0) throw unprocessable("Pipeline has no stages");

    const [run] = await db
      .insert(pipelineRuns)
      .values({
        companyId,
        pipelineTemplateId: templateId,
        title: input.title ?? template.title,
        status: "running",
        parentIssueId: input.parentIssueId ?? null,
        launchedByAgentId: actor.agentId ?? null,
        launchedByUserId: actor.userId ?? null,
        inputPayload: input.inputPayload ?? null,
        startedAt: new Date(),
      })
      .returning();

    // Create stage runs for all stages
    for (const stage of stages) {
      await db.insert(pipelineStageRuns).values({
        companyId,
        pipelineRunId: run.id,
        pipelineStageId: stage.id,
        status: "pending",
      });
    }

    // Kick off first stage(s)
    await advanceRun(run.id);
    return getRun(run.id);
  }

  async function advanceRun(runId: string) {
    const run = await getRun(runId);
    if (!run || run.status !== "running") return;

    const allStageRuns = await db
      .select()
      .from(pipelineStageRuns)
      .where(eq(pipelineStageRuns.pipelineRunId, runId));

    // Load stages for ordering info
    const stageIds = [...new Set(allStageRuns.map((sr) => sr.pipelineStageId))];
    const stageRows = stageIds.length > 0
      ? await db.select().from(pipelineStages).where(inArray(pipelineStages.id, stageIds))
      : [];
    const stageMap = new Map(stageRows.map((s) => [s.id, s]));

    // Find the lowest stageOrder that still has pending stage runs
    const pendingStageRuns = allStageRuns.filter((sr) => sr.status === "pending");
    if (pendingStageRuns.length === 0) {
      // All done — or all failed/skipped/cancelled
      const anyRunning = allStageRuns.some((sr) => sr.status === "running" || sr.status === "waiting_approval");
      if (!anyRunning) {
        const anyFailed = allStageRuns.some((sr) => sr.status === "failed");
        await db
          .update(pipelineRuns)
          .set({
            status: anyFailed ? "failed" : "completed",
            currentStageOrder: null,
            completedAt: anyFailed ? undefined : new Date(),
            failedAt: anyFailed ? new Date() : undefined,
            updatedAt: new Date(),
          })
          .where(eq(pipelineRuns.id, runId));
      }
      return;
    }

    // Get the lowest pending stageOrder
    const pendingOrders = pendingStageRuns
      .map((sr) => stageMap.get(sr.pipelineStageId)?.stageOrder ?? Infinity)
      .filter((o) => o !== Infinity);
    if (pendingOrders.length === 0) return;
    const nextOrder = Math.min(...pendingOrders);

    // Check that all stage runs at lower orders are complete
    const lowerOrderRuns = allStageRuns.filter((sr) => {
      const order = stageMap.get(sr.pipelineStageId)?.stageOrder;
      return order !== undefined && order < nextOrder;
    });
    const allLowerComplete = lowerOrderRuns.every(
      (sr) => sr.status === "completed" || sr.status === "skipped" || sr.status === "cancelled",
    );
    if (!allLowerComplete) return; // Still waiting for lower-order stages

    // Gather output context from all completed prior stages
    const completedRuns = allStageRuns.filter((sr) => sr.status === "completed" && sr.outputContext);
    const aggregatedContext: Record<string, unknown> = {};
    for (const cr of completedRuns) {
      const stage = stageMap.get(cr.pipelineStageId);
      if (stage && cr.outputContext) {
        aggregatedContext[stage.title] = cr.outputContext;
      }
    }

    // Start all pending stage runs at this order
    const stageRunsToStart = pendingStageRuns.filter((sr) => {
      const order = stageMap.get(sr.pipelineStageId)?.stageOrder;
      return order === nextOrder;
    });

    await db
      .update(pipelineRuns)
      .set({ currentStageOrder: nextOrder, updatedAt: new Date() })
      .where(eq(pipelineRuns.id, runId));

    for (const stageRun of stageRunsToStart) {
      const stage = stageMap.get(stageRun.pipelineStageId);
      if (!stage) continue;

      const agentId = await resolveAgentForStage(run.companyId, stage);
      if (!agentId) {
        logger.warn(
          { stageRunId: stageRun.id, stageTitle: stage.title },
          "No agent found for pipeline stage — marking failed",
        );
        await db
          .update(pipelineStageRuns)
          .set({ status: "failed", failedAt: new Date(), updatedAt: new Date() })
          .where(eq(pipelineStageRuns.id, stageRun.id));
        continue;
      }

      // Build issue description with context from prior stages
      const contextLines: string[] = [];
      if (stage.suggestedSkillId) {
        const [skill] = await db
          .select({ name: companySkills.name, key: companySkills.key })
          .from(companySkills)
          .where(eq(companySkills.id, stage.suggestedSkillId))
          .limit(1);
        if (skill) {
          contextLines.push(`**Suggested skill:** ${skill.name} (\`${skill.key}\`)\n`);
        }
      }
      if (stage.description) contextLines.push(stage.description);
      if (Object.keys(aggregatedContext).length > 0) {
        contextLines.push("\n---\n**Pipeline context from prior stages:**\n```json\n" + JSON.stringify(aggregatedContext, null, 2) + "\n```");
      }
      if (run.inputPayload && Object.keys(run.inputPayload).length > 0) {
        contextLines.push("\n**Pipeline input:**\n```json\n" + JSON.stringify(run.inputPayload, null, 2) + "\n```");
      }

      try {
        const createdIssue = await issueSvc.create(run.companyId, {
          projectId: (await getTemplate(run.pipelineTemplateId))?.projectId ?? undefined,
          parentId: run.parentIssueId ?? undefined,
          title: `[Pipeline] ${stage.title}`,
          description: contextLines.join("\n") || null,
          status: "todo",
          priority: stage.priority,
          assigneeAgentId: agentId,
          originKind: "pipeline_stage",
          originId: run.id,
          originRunId: stageRun.id,
        });

        await db
          .update(pipelineStageRuns)
          .set({
            status: "running",
            issueId: createdIssue.id,
            resolvedAgentId: agentId,
            inputContext: Object.keys(aggregatedContext).length > 0 ? aggregatedContext : null,
            startedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(pipelineStageRuns.id, stageRun.id));

        queueIssueAssignmentWakeup({
          issue: { id: createdIssue.id, assigneeAgentId: agentId, status: "todo" },
          heartbeat,
          reason: `Pipeline stage: ${stage.title}`,
          mutation: "pipeline.stage.started",
          contextSource: "pipeline",
        });
      } catch (err) {
        logger.error({ err, stageRunId: stageRun.id }, "Failed to create issue for pipeline stage");
        await db
          .update(pipelineStageRuns)
          .set({ status: "failed", failedAt: new Date(), updatedAt: new Date() })
          .where(eq(pipelineStageRuns.id, stageRun.id));
      }
    }
  }

  async function syncStageRunForIssue(issueId: string) {
    const stageRunRows = await db
      .select()
      .from(pipelineStageRuns)
      .where(eq(pipelineStageRuns.issueId, issueId));
    if (stageRunRows.length === 0) return;
    const stageRun = stageRunRows[0];

    // Get the issue status
    const issueRows = await db
      .select({ status: issues.status })
      .from(issues)
      .where(eq(issues.id, issueId));
    if (issueRows.length === 0) return;
    const issueStatus = issueRows[0].status;

    if (issueStatus === "done" && stageRun.status === "running") {
      // Capture work products and documents as output context
      const outputContext: Record<string, unknown> = {};

      const workProducts = await db
        .select({
          id: issueWorkProducts.id,
          type: issueWorkProducts.type,
          title: issueWorkProducts.title,
          url: issueWorkProducts.url,
        })
        .from(issueWorkProducts)
        .where(eq(issueWorkProducts.issueId, issueId));
      if (workProducts.length > 0) {
        outputContext.workProducts = workProducts;
      }

      const docs = await db
        .select({
          id: issueDocuments.id,
          key: issueDocuments.key,
        })
        .from(issueDocuments)
        .where(eq(issueDocuments.issueId, issueId));
      if (docs.length > 0) {
        outputContext.documents = docs;
      }

      await db
        .update(pipelineStageRuns)
        .set({
          status: "completed",
          outputContext: Object.keys(outputContext).length > 0 ? outputContext : null,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(pipelineStageRuns.id, stageRun.id));

      // Advance the pipeline
      await advanceRun(stageRun.pipelineRunId);
    } else if (issueStatus === "cancelled" && stageRun.status === "running") {
      await db
        .update(pipelineStageRuns)
        .set({ status: "failed", failedAt: new Date(), updatedAt: new Date() })
        .where(eq(pipelineStageRuns.id, stageRun.id));

      // Fail the whole run
      await db
        .update(pipelineRuns)
        .set({ status: "failed", failedAt: new Date(), updatedAt: new Date() })
        .where(eq(pipelineRuns.id, stageRun.pipelineRunId));
    }
  }

  async function cancelRun(runId: string) {
    const run = await getRun(runId);
    if (!run) throw notFound("Pipeline run not found");
    if (run.status !== "running" && run.status !== "paused") {
      throw unprocessable("Can only cancel running or paused pipeline runs");
    }

    // Cancel all non-terminal stage runs
    await db
      .update(pipelineStageRuns)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(pipelineStageRuns.pipelineRunId, runId),
          inArray(pipelineStageRuns.status, ["pending", "running", "waiting_approval"]),
        ),
      );

    const [updated] = await db
      .update(pipelineRuns)
      .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(pipelineRuns.id, runId))
      .returning();

    return updated;
  }

  async function pauseRun(runId: string) {
    const run = await getRun(runId);
    if (!run) throw notFound("Pipeline run not found");
    if (run.status !== "running") throw unprocessable("Can only pause running pipeline runs");

    const [updated] = await db
      .update(pipelineRuns)
      .set({ status: "paused", updatedAt: new Date() })
      .where(eq(pipelineRuns.id, runId))
      .returning();
    return updated;
  }

  async function resumeRun(runId: string) {
    const run = await getRun(runId);
    if (!run) throw notFound("Pipeline run not found");
    if (run.status !== "paused") throw unprocessable("Can only resume paused pipeline runs");

    const [updated] = await db
      .update(pipelineRuns)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(pipelineRuns.id, runId))
      .returning();

    // Try to advance in case stages completed while paused
    await advanceRun(runId);
    return updated;
  }

  return {
    listTemplates,
    getTemplate,
    getTemplateDetail,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    listStages,
    getStage,
    createStage,
    updateStage,
    deleteStage,
    reorderStages,
    listRuns,
    getRun,
    getRunDetail,
    launchRun,
    advanceRun,
    syncStageRunForIssue,
    cancelRun,
    pauseRun,
    resumeRun,
  };
}
