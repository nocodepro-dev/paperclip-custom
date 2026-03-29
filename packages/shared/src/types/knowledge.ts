export type KnowledgeCollectionSourceType = "local_path" | "github" | "url";

export type KnowledgeCollectionStatus = "active" | "stale" | "unreachable";

export type KnowledgeEntryKind =
  | "document"
  | "design_system"
  | "schema"
  | "screenshot"
  | "flow"
  | "brief"
  | "sop"
  | "asset"
  | "other";

export interface KnowledgeCollection {
  id: string;
  companyId: string;
  projectId: string | null;
  name: string;
  description: string | null;
  sourceType: KnowledgeCollectionSourceType;
  sourcePath: string;
  autoDiscover: boolean;
  lastScannedAt: Date | null;
  entryCount: number;
  totalBytes: number;
  status: KnowledgeCollectionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeEntry {
  id: string;
  collectionId: string;
  companyId: string;
  relativePath: string;
  name: string;
  kind: KnowledgeEntryKind;
  contentType: string;
  byteSize: number;
  sha256: string | null;
  summary: string | null;
  lastVerifiedAt: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeCollectionDetail extends KnowledgeCollection {
  entries: KnowledgeEntry[];
}

export interface KnowledgeCollectionCreateRequest {
  name: string;
  description?: string | null;
  sourceType?: KnowledgeCollectionSourceType;
  sourcePath: string;
  projectId?: string | null;
  autoDiscover?: boolean;
}

export interface KnowledgeCollectionUpdateRequest {
  name?: string;
  description?: string | null;
  autoDiscover?: boolean;
  status?: KnowledgeCollectionStatus;
}

export interface KnowledgeEntryUpdateRequest {
  name?: string;
  kind?: KnowledgeEntryKind;
  summary?: string | null;
}

export interface KnowledgeRescanResult {
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
}

export interface KnowledgeEntryManifest {
  id: string;
  name: string;
  kind: KnowledgeEntryKind;
  relativePath: string;
  summary: string | null;
  contentType: string;
  byteSize: number;
}

export interface KnowledgeCollectionManifest {
  id: string;
  name: string;
  description: string | null;
  entries: KnowledgeEntryManifest[];
}

export interface KnowledgeManifest {
  companyCollections: KnowledgeCollectionManifest[];
  projectCollections: KnowledgeCollectionManifest[];
}
