import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import AdmZip from "adm-zip";

const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_REDIRECTS = 5;

interface ParsedGitHubRepo {
  owner: string;
  repo: string;
}

function parseGitHubRepoUrl(remoteUrl: string): ParsedGitHubRepo {
  const trimmed = remoteUrl.trim();
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (sshMatch) {
    return { owner: sshMatch[1]!, repo: sshMatch[2]! };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Cannot parse Git URL: ${remoteUrl}`);
  }

  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    throw new Error(
      `GitHub archive fallback only supports github.com URLs; got ${url.hostname}. Install git to use this remote.`,
    );
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`Invalid GitHub URL: ${remoteUrl}`);
  }
  return {
    owner: parts[0]!,
    repo: parts[1]!.replace(/\.git$/i, ""),
  };
}

async function downloadToBuffer(targetUrl: string, redirectsLeft = MAX_REDIRECTS): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.get(targetUrl, { headers: { "User-Agent": "paperclip-workspace" } }, (res) => {
      const status = res.statusCode ?? 0;

      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(new Error(`Too many redirects while downloading ${targetUrl}`));
          return;
        }
        const location = res.headers.location.startsWith("http")
          ? res.headers.location
          : new URL(res.headers.location, targetUrl).toString();
        downloadToBuffer(location, redirectsLeft - 1).then(resolve, reject);
        return;
      }

      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status} from ${targetUrl}`));
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      res.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_ARCHIVE_BYTES) {
          req.destroy(new Error(`Archive exceeds ${MAX_ARCHIVE_BYTES} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      req.destroy(new Error(`Download timed out after ${DOWNLOAD_TIMEOUT_MS}ms`));
    });
  });
}

function extractZipIntoDir(zipBuffer: Buffer, targetDir: string): void {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  if (entries.length === 0) {
    throw new Error("Archive is empty");
  }

  const topLevelNames = new Set<string>();
  for (const entry of entries) {
    const firstSegment = entry.entryName.split("/")[0];
    if (firstSegment) topLevelNames.add(firstSegment);
  }
  if (topLevelNames.size !== 1) {
    throw new Error(
      `Unexpected archive layout (found ${topLevelNames.size} top-level entries; expected 1)`,
    );
  }
  const wrapperName = [...topLevelNames][0]!;
  const wrapperPrefix = `${wrapperName}/`;

  for (const entry of entries) {
    if (entry.entryName === wrapperName || entry.entryName === wrapperPrefix) continue;
    if (!entry.entryName.startsWith(wrapperPrefix)) continue;

    const relPath = entry.entryName.slice(wrapperPrefix.length);
    if (!relPath) continue;

    const outPath = path.join(targetDir, relPath);
    if (entry.isDirectory) {
      // Directory entries are handled implicitly when writing files
      continue;
    }

    const data = entry.getData();
    const dir = path.dirname(outPath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(outPath, data);
  }
}

export async function downloadGitHubArchive(
  remoteUrl: string,
  targetDir: string,
  branch: string,
): Promise<void> {
  const { owner, repo } = parseGitHubRepoUrl(remoteUrl);

  // Try the requested branch first, then fall back to "master" if "main" 404s
  const candidates = branch === "main" ? ["main", "master"] : [branch];
  let lastError: Error | null = null;

  for (const candidate of candidates) {
    const archiveUrl = `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${candidate}`;
    try {
      const buffer = await downloadToBuffer(archiveUrl);

      // Fresh target dir
      await rm(targetDir, { recursive: true, force: true });
      await mkdir(targetDir, { recursive: true });

      extractZipIntoDir(buffer, targetDir);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const message = lastError.message;
      const notFound = message.includes("HTTP 404");
      if (!notFound) {
        throw lastError;
      }
      // else: try next candidate
    }
  }

  throw new Error(
    `GitHub archive download failed for ${owner}/${repo}: ${lastError?.message ?? "branch not found"}. ` +
      `If this is a private repo, make it temporarily public or install git to use authenticated clone.`,
  );
}
