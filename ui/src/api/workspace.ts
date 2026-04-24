import { api } from "./client";

export interface WorkspaceStatus {
  workspaceDir: string;
  hasRemote: boolean;
  remoteUrl: string | null;
  pendingChanges: number;
  lastCommit: { sha: string; message: string; date: string } | null;
}

export interface WorkspaceExportStats {
  workspaceDir: string;
  companies: number;
  activityLogEntries: number;
  costEvents: number;
  heartbeatRuns: number;
  warnings: string[];
}

export interface WorkspaceSyncResult {
  ok: boolean;
  exported: WorkspaceExportStats;
  committed: boolean;
  commitSha: string | null;
}

export interface WorkspaceImportStats {
  companies: number;
  activityLogEntries: number;
  costEvents: number;
  heartbeatRuns: number;
  warnings: string[];
}

export interface WorkspaceCloneOrPullResult {
  ok: boolean;
  imported: WorkspaceImportStats;
}

export const workspaceApi = {
  getStatus: () => api.get<WorkspaceStatus>("/workspace/status"),
  init: (remoteUrl: string, branch = "main") =>
    api.post<{ ok: boolean; workspaceDir: string; remoteUrl: string; branch: string }>(
      "/workspace/init",
      { remoteUrl, branch },
    ),
  sync: () => api.post<WorkspaceSyncResult>("/workspace/sync", {}),
  pull: () => api.post<WorkspaceCloneOrPullResult>("/workspace/pull", {}),
  clone: (remoteUrl: string, branch = "main") =>
    api.post<WorkspaceCloneOrPullResult>("/workspace/clone", { remoteUrl, branch }),
};
