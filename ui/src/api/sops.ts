import type {
  CompanySop,
  CompanySopDetail,
  SopAsset,
  SOPConversionResult,
} from "@paperclipai/shared";
import { api } from "./client";

export const sopsApi = {
  // SOP CRUD
  list: (companyId: string, filters?: { category?: string; status?: string }) => {
    const params = new URLSearchParams();
    if (filters?.category) params.set("category", filters.category);
    if (filters?.status) params.set("status", filters.status);
    const qs = params.toString();
    return api.get<CompanySop[]>(`/companies/${companyId}/sops${qs ? `?${qs}` : ""}`);
  },
  get: (sopId: string) =>
    api.get<CompanySopDetail>(`/sops/${sopId}`),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<CompanySop>(`/companies/${companyId}/sops`, data),
  update: (sopId: string, data: Record<string, unknown>) =>
    api.patch<CompanySop>(`/sops/${sopId}`, data),
  remove: (sopId: string) =>
    api.delete<void>(`/sops/${sopId}`),

  // Assets
  listAssets: (sopId: string) =>
    api.get<SopAsset[]>(`/sops/${sopId}/assets`),
  assetContentUrl: (sopId: string, assetId: string) =>
    `/api/sops/${sopId}/assets/${assetId}/content`,

  // Conversion
  startConversion: (sopId: string, mode: "auto" | "review", agentId?: string) =>
    api.post<SOPConversionResult>(`/sops/${sopId}/convert`, { mode, ...(agentId ? { agentId } : {}) }),
  getConversion: (sopId: string) =>
    api.get<SOPConversionResult>(`/sops/${sopId}/conversion`),
  approveConversion: (sopId: string) =>
    api.post<{ skillId: string }>(`/sops/${sopId}/conversion/approve`, {}),
  rejectConversion: (sopId: string, feedback: string) =>
    api.post<{ ok: boolean }>(`/sops/${sopId}/conversion/reject`, { feedback }),
};
