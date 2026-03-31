import { api } from "./client";

interface GuideListItem {
  slug: string;
  title: string;
}

interface GuideDetail {
  slug: string;
  title: string;
  body: string;
}

export const docsApi = {
  list: () => api.get<GuideListItem[]>("/docs"),
  get: (slug: string) => api.get<GuideDetail>(`/docs/${slug}`),
};
