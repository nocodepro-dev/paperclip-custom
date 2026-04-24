import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

export interface GitResult {
  stdout: string;
  stderr: string;
}

export async function gitRun(cwd: string, args: string[], timeoutMs = 120_000): Promise<GitResult> {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout, stderr };
}

export async function ensureWorkspaceDir(workspaceDir: string): Promise<void> {
  await mkdir(workspaceDir, { recursive: true });
}

export async function isGitRepo(workspaceDir: string): Promise<boolean> {
  try {
    await gitRun(workspaceDir, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

export async function initRepo(workspaceDir: string, remoteUrl: string, branch = "main"): Promise<void> {
  await ensureWorkspaceDir(workspaceDir);
  await gitRun(workspaceDir, ["init", "-b", branch]);
  await gitRun(workspaceDir, ["remote", "add", "origin", remoteUrl]);
}

export async function cloneRepo(remoteUrl: string, targetDir: string, branch = "main"): Promise<void> {
  const parent = path.dirname(targetDir);
  await mkdir(parent, { recursive: true });
  await gitRun(parent, ["clone", "-b", branch, remoteUrl, path.basename(targetDir)], 600_000);
}

export async function commitAll(workspaceDir: string, message: string): Promise<{ committed: boolean; sha: string | null }> {
  await gitRun(workspaceDir, ["add", "-A"]);
  const statusResult = await gitRun(workspaceDir, ["status", "--porcelain"]);
  if (!statusResult.stdout.trim()) {
    return { committed: false, sha: null };
  }
  await gitRun(workspaceDir, ["commit", "-m", message]);
  const shaResult = await gitRun(workspaceDir, ["rev-parse", "HEAD"]);
  return { committed: true, sha: shaResult.stdout.trim() };
}

export async function push(workspaceDir: string, branch = "main"): Promise<void> {
  await gitRun(workspaceDir, ["push", "-u", "origin", branch], 600_000);
}

export async function pull(workspaceDir: string, branch = "main"): Promise<void> {
  await gitRun(workspaceDir, ["pull", "origin", branch], 600_000);
}

export interface WorkspaceGitStatus {
  hasRemote: boolean;
  remoteUrl: string | null;
  pendingChanges: number;
  lastCommit: { sha: string; message: string; date: string } | null;
}

export async function getStatus(workspaceDir: string): Promise<WorkspaceGitStatus> {
  if (!(await isGitRepo(workspaceDir))) {
    return { hasRemote: false, remoteUrl: null, pendingChanges: 0, lastCommit: null };
  }

  let remoteUrl: string | null = null;
  try {
    const r = await gitRun(workspaceDir, ["remote", "get-url", "origin"]);
    remoteUrl = r.stdout.trim() || null;
  } catch {
    // no remote
  }

  const status = await gitRun(workspaceDir, ["status", "--porcelain"]);
  const pendingChanges = status.stdout.trim()
    ? status.stdout.trim().split("\n").filter((l) => l.trim()).length
    : 0;

  let lastCommit: { sha: string; message: string; date: string } | null = null;
  try {
    const logResult = await gitRun(workspaceDir, ["log", "-1", "--format=%H%x00%s%x00%aI"]);
    const parts = logResult.stdout.trim().split("\x00");
    if (parts.length >= 3 && parts[0]) {
      lastCommit = { sha: parts[0], message: parts[1], date: parts[2] };
    }
  } catch {
    // no commits yet
  }

  return { hasRemote: !!remoteUrl, remoteUrl, pendingChanges, lastCommit };
}
