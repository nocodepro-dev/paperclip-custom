import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  workspacePortabilityService,
  resolveWorkspaceDir,
} from "../services/workspace-portability.js";
import {
  getStatus as getGitStatus,
  initRepo,
  commitAll,
  push,
  pull,
  cloneRepo,
  isGitRepo,
  ensureWorkspaceDir,
} from "../services/workspace-git.js";
import { assertInstanceAdmin } from "./authz.js";

export function workspaceRoutes(db: Db): Router {
  const router = Router();
  const svc = workspacePortabilityService(db);

  // GET /api/workspace/status
  router.get("/workspace/status", async (req, res) => {
    assertInstanceAdmin(req);
    try {
      const workspaceDir = resolveWorkspaceDir();
      await ensureWorkspaceDir(workspaceDir);
      const status = await getGitStatus(workspaceDir);
      res.json({ workspaceDir, ...status });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get status";
      res.status(500).json({ error: message });
    }
  });

  // POST /api/workspace/export
  router.post("/workspace/export", async (req, res) => {
    assertInstanceAdmin(req);
    try {
      const workspaceDir = resolveWorkspaceDir();
      const result = await svc.exportWorkspace(workspaceDir);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed";
      res.status(500).json({ error: message });
    }
  });

  // POST /api/workspace/import
  router.post("/workspace/import", async (req, res) => {
    assertInstanceAdmin(req);
    try {
      const workspaceDir = resolveWorkspaceDir();
      const collisionStrategy = (req.body?.collisionStrategy as "rename" | "skip" | "replace" | undefined) ?? "rename";
      const result = await svc.importWorkspace(workspaceDir, { collisionStrategy });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      res.status(500).json({ error: message });
    }
  });

  // POST /api/workspace/init
  router.post("/workspace/init", async (req, res) => {
    assertInstanceAdmin(req);
    const { remoteUrl, branch = "main" } = req.body ?? {};
    if (!remoteUrl || typeof remoteUrl !== "string") {
      res.status(400).json({ error: "remoteUrl is required" });
      return;
    }
    try {
      const workspaceDir = resolveWorkspaceDir();
      if (await isGitRepo(workspaceDir)) {
        res.status(409).json({ error: "Workspace is already initialized as a git repo" });
        return;
      }
      await initRepo(workspaceDir, remoteUrl, branch);
      res.json({ ok: true, workspaceDir, remoteUrl, branch });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Init failed" });
    }
  });

  // POST /api/workspace/sync
  router.post("/workspace/sync", async (req, res) => {
    assertInstanceAdmin(req);
    try {
      const workspaceDir = resolveWorkspaceDir();
      const exportResult = await svc.exportWorkspace(workspaceDir);
      const commit = await commitAll(workspaceDir, `Workspace snapshot ${new Date().toISOString()}`);
      if (commit.committed) {
        try {
          await push(workspaceDir);
        } catch (pushErr) {
          res.status(500).json({
            error: `Committed locally but push failed: ${pushErr instanceof Error ? pushErr.message : String(pushErr)}`,
            exported: exportResult,
            committed: true,
            commitSha: commit.sha,
          });
          return;
        }
      }
      res.json({
        ok: true,
        exported: exportResult,
        committed: commit.committed,
        commitSha: commit.sha,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Sync failed" });
    }
  });

  // POST /api/workspace/pull
  router.post("/workspace/pull", async (req, res) => {
    assertInstanceAdmin(req);
    try {
      const workspaceDir = resolveWorkspaceDir();
      await pull(workspaceDir);
      const result = await svc.importWorkspace(workspaceDir, { collisionStrategy: "skip" });
      res.json({ ok: true, imported: result });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Pull failed" });
    }
  });

  // POST /api/workspace/clone
  router.post("/workspace/clone", async (req, res) => {
    assertInstanceAdmin(req);
    const { remoteUrl, branch = "main" } = req.body ?? {};
    if (!remoteUrl || typeof remoteUrl !== "string") {
      res.status(400).json({ error: "remoteUrl is required" });
      return;
    }
    try {
      const workspaceDir = resolveWorkspaceDir();
      const method = await cloneRepo(remoteUrl, workspaceDir, branch);
      const result = await svc.importWorkspace(workspaceDir, { collisionStrategy: "rename" });
      res.json({ ok: true, imported: result, method });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Clone failed" });
    }
  });

  return router;
}
