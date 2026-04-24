/**
 * Local Extensions — registers custom CLI commands not in upstream Paperclip.
 *
 * @see doc/UPSTREAM-SYNC.md
 */
import type { Command } from "commander";
import { registerKnowledgeCommands } from "./commands/client/knowledge.js";
import { registerSopCommands } from "./commands/client/sop.js";
import { registerPipelineCommands } from "./commands/client/pipeline.js";
import { registerSkillEquipCommands } from "./commands/client/skill-equip.js";
import { registerWorkspaceCommands } from "./commands/client/workspace.js";

export function registerLocalCommands(program: Command): void {
  registerKnowledgeCommands(program);
  registerSopCommands(program);
  registerPipelineCommands(program);
  registerSkillEquipCommands(program);
  registerWorkspaceCommands(program);
}
