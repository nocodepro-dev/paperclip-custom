import type { IssueOriginKind } from "../constants.js";

export interface PipelineTemplate {
  id: string;
  companyId: string;
  projectId: string | null;
  goalId: string | null;
  title: string;
  description: string | null;
  status: string;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PipelineStage {
  id: string;
  companyId: string;
  pipelineTemplateId: string;
  title: string;
  description: string | null;
  stageOrder: number;
  parallelGroup: string | null;
  loopConfig: { sourceStageId: string; fieldPath: string } | null;
  assigneeAgentId: string | null;
  requiredCapability: string | null;
  priority: string;
  requiresApproval: boolean;
  timeoutMinutes: number | null;
  suggestedSkillId: string | null;
  stageConfig: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PipelineRun {
  id: string;
  companyId: string;
  pipelineTemplateId: string;
  title: string;
  status: string;
  parentIssueId: string | null;
  launchedByAgentId: string | null;
  launchedByUserId: string | null;
  inputPayload: Record<string, unknown> | null;
  outputSummary: Record<string, unknown> | null;
  currentStageOrder: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PipelineStageRun {
  id: string;
  companyId: string;
  pipelineRunId: string;
  pipelineStageId: string;
  issueId: string | null;
  status: string;
  loopIndex: number | null;
  inputContext: Record<string, unknown> | null;
  outputContext: Record<string, unknown> | null;
  resolvedAgentId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PipelineAgentSummary {
  id: string;
  name: string;
  role: string;
  title: string | null;
  urlKey?: string | null;
}

export interface PipelineIssueSummary {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  priority: string;
}

export interface PipelineStageRunDetail extends PipelineStageRun {
  stage: PipelineStage;
  issue: PipelineIssueSummary | null;
  resolvedAgent: PipelineAgentSummary | null;
}

export interface PipelineTemplateDetail extends PipelineTemplate {
  stages: PipelineStage[];
  recentRuns: PipelineRun[];
}

export interface PipelineRunDetail extends PipelineRun {
  template: Pick<PipelineTemplate, "id" | "title"> | null;
  stageRuns: PipelineStageRunDetail[];
}

export interface PipelineExecutionIssueOrigin {
  kind: Extract<IssueOriginKind, "pipeline_stage">;
  pipelineRunId: string;
  stageRunId: string | null;
}
