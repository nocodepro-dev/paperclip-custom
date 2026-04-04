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
  groupId: string | null;
  groupRole: KnowledgeGroupRole | null;
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
  groups: KnowledgeGroupManifest[];
  ungroupedEntries: KnowledgeEntryManifest[];
}

export interface KnowledgeManifest {
  companyCollections: KnowledgeCollectionManifest[];
  projectCollections: KnowledgeCollectionManifest[];
}

export type KnowledgeGroupKind = "flow" | "design_system" | "asset_bundle" | "document_set";

export type KnowledgeGroupRole = "primary" | "asset";

export interface KnowledgeGroup {
  id: string;
  collectionId: string;
  name: string;
  description: string | null;
  relativePath: string;
  kind: KnowledgeGroupKind;
  primaryEntryId: string | null;
  entryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeGroupDetail extends KnowledgeGroup {
  entries: KnowledgeEntry[];
}

export interface KnowledgeGroupContentResponse {
  group: {
    id: string;
    name: string;
    kind: KnowledgeGroupKind;
  };
  primary: {
    id: string;
    name: string;
    content: string;
  } | null;
  assets: Array<{
    id: string;
    name: string;
    relativePath: string;
    contentType: string;
    base64: string;
  }>;
}

export interface KnowledgeGroupManifest {
  id: string;
  name: string;
  kind: KnowledgeGroupKind;
  entryCount: number;
  primarySummary: string | null;
  entries: KnowledgeEntryManifest[];
}
