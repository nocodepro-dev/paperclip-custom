// ---- Phase 3: Tool Equipping types ----

export type ToolType = "mcp_server" | "cli_tool" | "paperclip_api" | "script";
export type ToolStatus = "installed" | "available" | "unavailable";

/**
 * A tool entry as seen by the company — shows availability status,
 * install instructions, and plugin match if any.
 */
export interface ToolRegistryEntry {
  toolId: string;
  name: string;
  type: ToolType;
  status: ToolStatus;
  installCommand: string | null;
  configRequired: boolean;
  configHints: string[];
  pluginMatch: string | null;
}

/**
 * A single tool requirement for a converted skill — includes which SOP
 * steps use it and current availability status.
 */
export interface SkillToolRequirement {
  toolId: string;
  name: string;
  status: ToolStatus;
  installCommand: string | null;
  configHints: string[];
  stepsUsing: number[];
}

/**
 * Full requirements report for a skill — lists all required tools with
 * availability status and a summary.
 */
export interface SkillRequirementsReport {
  skillId: string;
  skillName: string;
  requirements: SkillToolRequirement[];
  satisfied: number;
  total: number;
  allSatisfied: boolean;
}
