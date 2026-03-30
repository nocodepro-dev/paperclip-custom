import { Router } from "express";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Db } from "@paperclipai/db";
import { createSopSchema, updateSopSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { sopService, logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function sopRoutes(db: Db) {
  const router = Router();
  const svc = sopService(db);

  // ---- SOPs ----

  router.post(
    "/companies/:companyId/sops",
    validate(createSopSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      try {
        const { sourcePath, ...rest } = req.body;
        let sop;

        if (sourcePath) {
          // Directory-based upload: server scans the directory
          sop = await svc.createFromDirectory(companyId, sourcePath, rest);
        } else {
          // Direct markdown upload
          sop = await svc.create(companyId, req.body);
        }

        const actor = getActorInfo(req);
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          action: "sop.created",
          entityType: "sop",
          entityId: sop.id,
          details: { name: sop.name, sourceType: sop.sourceType },
        });
        res.status(201).json(sop);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create SOP";
        res.status(422).json({ error: message });
      }
    },
  );

  router.get("/companies/:companyId/sops", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const category = req.query.category as string | undefined;
    const status = req.query.status as string | undefined;
    const result = await svc.list(companyId, { category, status });
    res.json(result);
  });

  router.get("/sops/:id", async (req, res) => {
    const id = req.params.id as string;
    const detail = await svc.getDetail(id);
    if (!detail) {
      res.status(404).json({ error: "SOP not found" });
      return;
    }
    assertCompanyAccess(req, detail.companyId);
    res.json(detail);
  });

  router.patch(
    "/sops/:id",
    validate(updateSopSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const existing = await svc.getById(id);
      if (!existing) {
        res.status(404).json({ error: "SOP not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);
      const updated = await svc.update(id, req.body);
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: existing.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "sop.updated",
        entityType: "sop",
        entityId: id,
        details: req.body,
      });
      res.json(updated);
    },
  );

  router.delete("/sops/:id", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "SOP not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const actor = getActorInfo(req);
    await svc.remove(id);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "sop.deleted",
      entityType: "sop",
      entityId: id,
      details: { name: existing.name },
    });
    res.json({ ok: true });
  });

  // ---- SOP Assets ----

  router.get("/sops/:id/assets", async (req, res) => {
    const id = req.params.id as string;
    const sop = await svc.getById(id);
    if (!sop) {
      res.status(404).json({ error: "SOP not found" });
      return;
    }
    assertCompanyAccess(req, sop.companyId);
    const assets = await svc.listAssets(id);
    res.json(assets);
  });

  router.get("/sops/:id/assets/:assetId/content", async (req, res) => {
    const { id, assetId } = req.params;
    const sop = await svc.getById(id);
    if (!sop) {
      res.status(404).json({ error: "SOP not found" });
      return;
    }
    assertCompanyAccess(req, sop.companyId);

    const fullPath = await svc.resolveAssetPath(assetId);
    if (!fullPath) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }

    try {
      const fileStat = await stat(fullPath);
      const contentType = svc.detectContentType(fullPath);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", fileStat.size);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=60");
      createReadStream(fullPath).pipe(res);
    } catch {
      res.status(404).json({ error: "File no longer exists on disk" });
    }
  });

  return router;
}
