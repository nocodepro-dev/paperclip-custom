import { Router } from "express";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Db } from "@paperclipai/db";
import {
  createKnowledgeCollectionSchema,
  updateKnowledgeCollectionSchema,
  updateKnowledgeEntrySchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { knowledgeService, logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function knowledgeRoutes(db: Db) {
  const router = Router();
  const svc = knowledgeService(db);

  // ---- Collections ----

  router.post(
    "/companies/:companyId/knowledge/collections",
    validate(createKnowledgeCollectionSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      try {
        const collection = await svc.createCollection(companyId, req.body);
        const actor = getActorInfo(req);
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          action: "knowledge_collection.created",
          entityType: "knowledge_collection",
          entityId: collection.id,
          details: { name: collection.name, sourcePath: collection.sourcePath },
        });
        res.status(201).json(collection);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create collection";
        res.status(422).json({ error: message });
      }
    },
  );

  router.get("/companies/:companyId/knowledge/collections", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const projectId = req.query.projectId as string | undefined;
    const result = await svc.listCollections(companyId, projectId === undefined ? undefined : projectId || null);
    res.json(result);
  });

  router.get("/knowledge/collections/:id", async (req, res) => {
    const id = req.params.id as string;
    const collection = await svc.getCollectionById(id);
    if (!collection) {
      res.status(404).json({ error: "Collection not found" });
      return;
    }
    assertCompanyAccess(req, collection.companyId);
    const detail = await svc.getCollectionDetail(collection.companyId, id);
    res.json(detail);
  });

  router.patch(
    "/knowledge/collections/:id",
    validate(updateKnowledgeCollectionSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const existing = await svc.getCollectionById(id);
      if (!existing) {
        res.status(404).json({ error: "Collection not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);
      const updated = await svc.updateCollection(id, req.body);
      res.json(updated);
    },
  );

  router.delete("/knowledge/collections/:id", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getCollectionById(id);
    if (!existing) {
      res.status(404).json({ error: "Collection not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const actor = getActorInfo(req);
    await svc.removeCollection(id);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "knowledge_collection.deleted",
      entityType: "knowledge_collection",
      entityId: id,
      details: { name: existing.name },
    });
    res.json({ ok: true });
  });

  router.post("/knowledge/collections/:id/rescan", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getCollectionById(id);
    if (!existing) {
      res.status(404).json({ error: "Collection not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    try {
      const result = await svc.rescanCollection(id);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Rescan failed";
      res.status(422).json({ error: message });
    }
  });

  // ---- Entries ----

  router.get("/knowledge/entries/:id", async (req, res) => {
    const id = req.params.id as string;
    const entry = await svc.getEntryById(id);
    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    assertCompanyAccess(req, entry.companyId);
    res.json(entry);
  });

  router.get("/knowledge/entries/:id/content", async (req, res) => {
    const id = req.params.id as string;
    const entry = await svc.getEntryById(id);
    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    assertCompanyAccess(req, entry.companyId);

    const fullPath = await svc.resolveEntryContentPath(id);
    if (!fullPath) {
      res.status(404).json({ error: "Entry content path not found" });
      return;
    }

    try {
      const fileStat = await stat(fullPath);
      res.setHeader("Content-Type", entry.contentType);
      res.setHeader("Content-Length", fileStat.size);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=60");
      createReadStream(fullPath).pipe(res);
    } catch {
      // File no longer exists — mark as stale
      await svc.updateCollection(entry.collectionId, { status: "stale" });
      res.status(404).json({ error: "File no longer exists on disk" });
    }
  });

  router.patch(
    "/knowledge/entries/:id",
    validate(updateKnowledgeEntrySchema),
    async (req, res) => {
      const id = req.params.id as string;
      const existing = await svc.getEntryById(id);
      if (!existing) {
        res.status(404).json({ error: "Entry not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);
      const updated = await svc.updateEntry(id, req.body);
      res.json(updated);
    },
  );

  // ---- Search ----

  router.get("/companies/:companyId/knowledge/search", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const q = (req.query.q as string) || "";
    if (!q.trim()) {
      res.json([]);
      return;
    }
    const projectId = req.query.projectId as string | undefined;
    const kind = req.query.kind as string | undefined;
    const results = await svc.searchEntries(companyId, q.trim(), { projectId, kind });
    res.json(results);
  });

  // ── Group endpoints ──────────────────────────────────────────────

  router.get("/knowledge/collections/:id/groups", async (req, res) => {
    const id = req.params.id as string;
    const collection = await svc.getCollectionById(id);
    if (!collection) {
      res.status(404).json({ error: "Collection not found" });
      return;
    }
    assertCompanyAccess(req, collection.companyId);
    const groups = await svc.listGroups(id);
    res.json(groups);
  });

  router.get("/knowledge/groups/:groupId", async (req, res) => {
    const groupId = req.params.groupId as string;
    const detail = await svc.getGroupDetail(groupId);
    if (!detail) {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    const collection = await svc.getCollectionById(detail.collectionId);
    if (!collection) {
      res.status(404).json({ error: "Collection not found" });
      return;
    }
    assertCompanyAccess(req, collection.companyId);
    res.json(detail);
  });

  router.get("/knowledge/groups/:groupId/content", async (req, res) => {
    const groupId = req.params.groupId as string;
    const group = await svc.getGroupById(groupId);
    if (!group) {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    const collection = await svc.getCollectionById(group.collectionId);
    if (!collection) {
      res.status(404).json({ error: "Collection not found" });
      return;
    }
    assertCompanyAccess(req, collection.companyId);

    try {
      const content = await svc.getGroupContent(groupId);
      if (!content) {
        res.status(404).json({ error: "Group content not found" });
        return;
      }
      res.json(content);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to retrieve group content";
      res.status(500).json({ error: message });
    }
  });

  return router;
}
