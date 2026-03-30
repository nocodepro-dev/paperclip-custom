import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createPipelineTemplateSchema,
  updatePipelineTemplateSchema,
  createPipelineStageSchema,
  updatePipelineStageSchema,
  launchPipelineRunSchema,
  reorderPipelineStagesSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { logActivity, pipelineService } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function pipelineRoutes(db: Db) {
  const router = Router();
  const svc = pipelineService(db);

  // ---------------------------------------------------------------------------
  // Template CRUD
  // ---------------------------------------------------------------------------

  router.get("/companies/:companyId/pipelines", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await svc.listTemplates(companyId);
    res.json(result);
  });

  router.post(
    "/companies/:companyId/pipelines",
    validate(createPipelineTemplateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const created = await svc.createTemplate(companyId, req.body, {
        agentId: actor.agentId,
        userId: actor.actorType === "user" ? actor.actorId : null,
      });
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "pipeline.created",
        entityType: "pipeline_template",
        entityId: created.id,
        details: { title: created.title },
      });
      res.status(201).json(created);
    },
  );

  router.get("/companies/:companyId/pipelines/:pipelineId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const detail = await svc.getTemplateDetail(req.params.pipelineId as string);
    if (!detail || detail.companyId !== companyId) {
      res.status(404).json({ error: "Pipeline not found" });
      return;
    }
    res.json(detail);
  });

  router.patch(
    "/companies/:companyId/pipelines/:pipelineId",
    validate(updatePipelineTemplateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const existing = await svc.getTemplate(req.params.pipelineId as string);
      if (!existing || existing.companyId !== companyId) {
        res.status(404).json({ error: "Pipeline not found" });
        return;
      }
      const updated = await svc.updateTemplate(existing.id, req.body);
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "pipeline.updated",
        entityType: "pipeline_template",
        entityId: existing.id,
        details: req.body,
      });
      res.json(updated);
    },
  );

  router.delete("/companies/:companyId/pipelines/:pipelineId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const existing = await svc.getTemplate(req.params.pipelineId as string);
    if (!existing || existing.companyId !== companyId) {
      res.status(404).json({ error: "Pipeline not found" });
      return;
    }
    await svc.deleteTemplate(existing.id);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "pipeline.archived",
      entityType: "pipeline_template",
      entityId: existing.id,
      details: { title: existing.title },
    });
    res.status(204).end();
  });

  // ---------------------------------------------------------------------------
  // Stage CRUD
  // ---------------------------------------------------------------------------

  router.post(
    "/companies/:companyId/pipelines/:pipelineId/stages",
    validate(createPipelineStageSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const template = await svc.getTemplate(req.params.pipelineId as string);
      if (!template || template.companyId !== companyId) {
        res.status(404).json({ error: "Pipeline not found" });
        return;
      }
      const created = await svc.createStage(template.id, companyId, req.body);
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "pipeline.stage.created",
        entityType: "pipeline_stage",
        entityId: created.id,
        details: { title: created.title, stageOrder: created.stageOrder },
      });
      res.status(201).json(created);
    },
  );

  router.patch(
    "/companies/:companyId/pipelines/:pipelineId/stages/:stageId",
    validate(updatePipelineStageSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const stage = await svc.getStage(req.params.stageId as string);
      if (!stage || stage.companyId !== companyId) {
        res.status(404).json({ error: "Stage not found" });
        return;
      }
      const updated = await svc.updateStage(stage.id, req.body);
      res.json(updated);
    },
  );

  router.delete(
    "/companies/:companyId/pipelines/:pipelineId/stages/:stageId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const stage = await svc.getStage(req.params.stageId as string);
      if (!stage || stage.companyId !== companyId) {
        res.status(404).json({ error: "Stage not found" });
        return;
      }
      await svc.deleteStage(stage.id);
      res.status(204).end();
    },
  );

  router.post(
    "/companies/:companyId/pipelines/:pipelineId/stages/reorder",
    validate(reorderPipelineStagesSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const template = await svc.getTemplate(req.params.pipelineId as string);
      if (!template || template.companyId !== companyId) {
        res.status(404).json({ error: "Pipeline not found" });
        return;
      }
      await svc.reorderStages(template.id, req.body.stageIds);
      const stages = await svc.listStages(template.id);
      res.json(stages);
    },
  );

  // ---------------------------------------------------------------------------
  // Run management
  // ---------------------------------------------------------------------------

  router.post(
    "/companies/:companyId/pipelines/:pipelineId/runs",
    validate(launchPipelineRunSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const run = await svc.launchRun(companyId, req.params.pipelineId as string, req.body, {
        agentId: actor.agentId,
        userId: actor.actorType === "user" ? actor.actorId : null,
      });
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "pipeline.run.launched",
        entityType: "pipeline_run",
        entityId: run!.id,
        details: { title: run!.title, pipelineTemplateId: req.params.pipelineId },
      });
      res.status(201).json(run);
    },
  );

  router.get("/companies/:companyId/pipeline-runs", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await svc.listRuns(companyId, {
      status: req.query.status as string | undefined,
      pipelineTemplateId: req.query.pipelineTemplateId as string | undefined,
    });
    res.json(result);
  });

  router.get("/companies/:companyId/pipeline-runs/:runId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const detail = await svc.getRunDetail(req.params.runId as string);
    if (!detail || detail.companyId !== companyId) {
      res.status(404).json({ error: "Pipeline run not found" });
      return;
    }
    res.json(detail);
  });

  router.post("/companies/:companyId/pipeline-runs/:runId/cancel", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const run = await svc.getRun(req.params.runId as string);
    if (!run || run.companyId !== companyId) {
      res.status(404).json({ error: "Pipeline run not found" });
      return;
    }
    const updated = await svc.cancelRun(run.id);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "pipeline.run.cancelled",
      entityType: "pipeline_run",
      entityId: run.id,
    });
    res.json(updated);
  });

  router.post("/companies/:companyId/pipeline-runs/:runId/pause", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const run = await svc.getRun(req.params.runId as string);
    if (!run || run.companyId !== companyId) {
      res.status(404).json({ error: "Pipeline run not found" });
      return;
    }
    const updated = await svc.pauseRun(run.id);
    res.json(updated);
  });

  router.post("/companies/:companyId/pipeline-runs/:runId/resume", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const run = await svc.getRun(req.params.runId as string);
    if (!run || run.companyId !== companyId) {
      res.status(404).json({ error: "Pipeline run not found" });
      return;
    }
    const updated = await svc.resumeRun(run.id);
    res.json(updated);
  });

  return router;
}
