import { z } from "zod";

export const toolTypeSchema = z.enum(["mcp_server", "cli_tool", "paperclip_api", "script"]);

export const toolStatusSchema = z.enum(["installed", "available", "unavailable"]);

export const toolRegistryEntrySchema = z.object({
  toolId: z.string().min(1),
  name: z.string().min(1),
  type: toolTypeSchema,
  status: toolStatusSchema,
  installCommand: z.string().nullable(),
  configRequired: z.boolean(),
  configHints: z.array(z.string()),
  pluginMatch: z.string().nullable(),
});

export const skillToolRequirementSchema = z.object({
  toolId: z.string().min(1),
  name: z.string().min(1),
  status: toolStatusSchema,
  installCommand: z.string().nullable(),
  configHints: z.array(z.string()),
  stepsUsing: z.array(z.number().int()),
});

export const skillRequirementsReportSchema = z.object({
  skillId: z.string(),
  skillName: z.string(),
  requirements: z.array(skillToolRequirementSchema),
  satisfied: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  allSatisfied: z.boolean(),
});
