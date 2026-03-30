import type {
  PipelineTemplate,
  PipelineTemplateDetail,
  PipelineStage,
  PipelineRun,
  PipelineRunDetail,
} from "@paperclipai/shared";
import { api } from "./client";

export const pipelinesApi = {
  // Template CRUD
  list: (companyId: string) =>
    api.get<PipelineTemplate[]>(`/companies/${companyId}/pipelines`),
  get: (companyId: string, id: string) =>
    api.get<PipelineTemplateDetail>(`/companies/${companyId}/pipelines/${id}`),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<PipelineTemplate>(`/companies/${companyId}/pipelines`, data),
  update: (companyId: string, id: string, data: Record<string, unknown>) =>
    api.patch<PipelineTemplate>(`/companies/${companyId}/pipelines/${id}`, data),
  remove: (companyId: string, id: string) =>
    api.delete<void>(`/companies/${companyId}/pipelines/${id}`),

  // Stage CRUD
  createStage: (companyId: string, pipelineId: string, data: Record<string, unknown>) =>
    api.post<PipelineStage>(`/companies/${companyId}/pipelines/${pipelineId}/stages`, data),
  updateStage: (companyId: string, pipelineId: string, stageId: string, data: Record<string, unknown>) =>
    api.patch<PipelineStage>(`/companies/${companyId}/pipelines/${pipelineId}/stages/${stageId}`, data),
  removeStage: (companyId: string, pipelineId: string, stageId: string) =>
    api.delete<void>(`/companies/${companyId}/pipelines/${pipelineId}/stages/${stageId}`),
  reorderStages: (companyId: string, pipelineId: string, stageIds: string[]) =>
    api.post<PipelineStage[]>(`/companies/${companyId}/pipelines/${pipelineId}/stages/reorder`, { stageIds }),

  // Run management
  launchRun: (companyId: string, pipelineId: string, data?: Record<string, unknown>) =>
    api.post<PipelineRun>(`/companies/${companyId}/pipelines/${pipelineId}/runs`, data ?? {}),
  listRuns: (companyId: string, filters?: { status?: string; pipelineTemplateId?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.pipelineTemplateId) params.set("pipelineTemplateId", filters.pipelineTemplateId);
    const qs = params.toString();
    return api.get<PipelineRun[]>(`/companies/${companyId}/pipeline-runs${qs ? `?${qs}` : ""}`);
  },
  getRun: (companyId: string, runId: string) =>
    api.get<PipelineRunDetail>(`/companies/${companyId}/pipeline-runs/${runId}`),
  cancelRun: (companyId: string, runId: string) =>
    api.post<PipelineRun>(`/companies/${companyId}/pipeline-runs/${runId}/cancel`, {}),
  pauseRun: (companyId: string, runId: string) =>
    api.post<PipelineRun>(`/companies/${companyId}/pipeline-runs/${runId}/pause`, {}),
  resumeRun: (companyId: string, runId: string) =>
    api.post<PipelineRun>(`/companies/${companyId}/pipeline-runs/${runId}/resume`, {}),
};
