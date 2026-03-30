/**
 * Local Extensions — registers custom routes that are not part of upstream Paperclip.
 *
 * This file consolidates all custom feature route registrations into a single
 * entry point so upstream merges only require one line in app.ts.
 *
 * @see doc/UPSTREAM-SYNC.md
 */
import type { Router } from "express";
import type { Db } from "@paperclipai/db";
import { knowledgeRoutes } from "./routes/knowledge.js";
import { sopRoutes } from "./routes/sops.js";
import { pipelineRoutes } from "./routes/pipelines.js";
import { toolRoutes } from "./routes/tools.js";

export function registerLocalRoutes(api: Router, db: Db): void {
  api.use(knowledgeRoutes(db));
  api.use(sopRoutes(db));
  api.use(pipelineRoutes(db));
  api.use(toolRoutes(db));
}
