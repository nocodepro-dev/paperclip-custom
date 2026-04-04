// Local Extensions — custom constants not in upstream Paperclip

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

export const PIPELINE_TEMPLATE_STATUSES = ["active", "archived"] as const;
export type PipelineTemplateStatus = (typeof PIPELINE_TEMPLATE_STATUSES)[number];

export const PIPELINE_RUN_STATUSES = ["pending", "running", "paused", "completed", "failed", "cancelled"] as const;
export type PipelineRunStatus = (typeof PIPELINE_RUN_STATUSES)[number];

export const PIPELINE_STAGE_RUN_STATUSES = ["pending", "waiting_approval", "running", "completed", "failed", "skipped", "cancelled"] as const;
export type PipelineStageRunStatus = (typeof PIPELINE_STAGE_RUN_STATUSES)[number];

// ---------------------------------------------------------------------------
// SOP Pipeline
// ---------------------------------------------------------------------------

export const SOP_STATUSES = ["draft", "active", "converting", "converted", "archived"] as const;
export type SopStatus = (typeof SOP_STATUSES)[number];

export const SOP_SOURCE_TYPES = ["upload", "replaydoc_export", "local_path"] as const;
export type SopSourceType = (typeof SOP_SOURCE_TYPES)[number];

export const SOP_ASSET_KINDS = ["screenshot", "template", "example", "reference"] as const;
export type SopAssetKind = (typeof SOP_ASSET_KINDS)[number];

// ---------------------------------------------------------------------------
// Knowledge Groups
// ---------------------------------------------------------------------------

export const KNOWLEDGE_GROUP_KINDS = ["flow", "design_system", "asset_bundle", "document_set"] as const;
export type KnowledgeGroupKind = (typeof KNOWLEDGE_GROUP_KINDS)[number];

export const KNOWLEDGE_GROUP_ROLES = ["primary", "asset"] as const;
export type KnowledgeGroupRole = (typeof KNOWLEDGE_GROUP_ROLES)[number];
