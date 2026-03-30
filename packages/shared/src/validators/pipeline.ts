import { z } from "zod";
import {
  ISSUE_PRIORITIES,
  PIPELINE_TEMPLATE_STATUSES,
} from "../constants.js";

export const createPipelineTemplateSchema = z.object({
  projectId: z.string().uuid().optional().nullable(),
  goalId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1).max(200),
  description: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export type CreatePipelineTemplate = z.infer<typeof createPipelineTemplateSchema>;

export const updatePipelineTemplateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().optional().nullable(),
  status: z.enum(PIPELINE_TEMPLATE_STATUSES).optional(),
  projectId: z.string().uuid().optional().nullable(),
  goalId: z.string().uuid().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export type UpdatePipelineTemplate = z.infer<typeof updatePipelineTemplateSchema>;

export const createPipelineStageSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().optional().nullable(),
  stageOrder: z.number().int().min(0),
  parallelGroup: z.string().trim().max(100).optional().nullable(),
  loopConfig: z.object({
    sourceStageId: z.string().uuid(),
    fieldPath: z.string().trim().min(1),
  }).optional().nullable(),
  assigneeAgentId: z.string().uuid().optional().nullable(),
  requiredCapability: z.string().trim().max(200).optional().nullable(),
  priority: z.enum(ISSUE_PRIORITIES).optional().default("medium"),
  requiresApproval: z.boolean().optional().default(false),
  timeoutMinutes: z.number().int().min(1).optional().nullable(),
  stageConfig: z.record(z.unknown()).optional().nullable(),
});

export type CreatePipelineStage = z.infer<typeof createPipelineStageSchema>;

export const updatePipelineStageSchema = createPipelineStageSchema.partial();
export type UpdatePipelineStage = z.infer<typeof updatePipelineStageSchema>;

export const launchPipelineRunSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  parentIssueId: z.string().uuid().optional().nullable(),
  inputPayload: z.record(z.unknown()).optional().nullable(),
});

export type LaunchPipelineRun = z.infer<typeof launchPipelineRunSchema>;

export const reorderPipelineStagesSchema = z.object({
  stageIds: z.array(z.string().uuid()).min(1),
});

export type ReorderPipelineStages = z.infer<typeof reorderPipelineStagesSchema>;
