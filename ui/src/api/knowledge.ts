import type {
  KnowledgeCollection,
  KnowledgeCollectionDetail,
  KnowledgeEntry,
  KnowledgeRescanResult,
} from "@paperclipai/shared";
import { api } from "./client";

export const knowledgeApi = {
  // Collection CRUD
  list: (companyId: string, projectId?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    const qs = params.toString();
    return api.get<KnowledgeCollection[]>(
      `/companies/${companyId}/knowledge/collections${qs ? `?${qs}` : ""}`,
    );
  },
  get: (collectionId: string) =>
    api.get<KnowledgeCollectionDetail>(`/knowledge/collections/${collectionId}`),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<KnowledgeCollection>(`/companies/${companyId}/knowledge/collections`, data),
  update: (collectionId: string, data: Record<string, unknown>) =>
    api.patch<KnowledgeCollection>(`/knowledge/collections/${collectionId}`, data),
  remove: (collectionId: string) =>
    api.delete<void>(`/knowledge/collections/${collectionId}`),
  rescan: (collectionId: string) =>
    api.post<KnowledgeRescanResult>(`/knowledge/collections/${collectionId}/rescan`, {}),

  // Entries
  getEntry: (entryId: string) =>
    api.get<KnowledgeEntry>(`/knowledge/entries/${entryId}`),
  updateEntry: (entryId: string, data: Record<string, unknown>) =>
    api.patch<KnowledgeEntry>(`/knowledge/entries/${entryId}`, data),
  entryContentUrl: (entryId: string) =>
    `/api/knowledge/entries/${entryId}/content`,

  // Search
  search: (companyId: string, q: string, filters?: { projectId?: string; kind?: string }) => {
    const params = new URLSearchParams();
    params.set("q", q);
    if (filters?.projectId) params.set("projectId", filters.projectId);
    if (filters?.kind) params.set("kind", filters.kind);
    return api.get<KnowledgeEntry[]>(
      `/companies/${companyId}/knowledge/search?${params.toString()}`,
    );
  },
};
