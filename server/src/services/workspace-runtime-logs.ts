import { createWriteStream, createReadStream } from "node:fs";
import { createGzip, createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { mkdir, stat } from "node:fs/promises";
import type { Db } from "@paperclipai/db";
import { activityLog, costEvents, heartbeatRuns } from "@paperclipai/db";
import { asc } from "drizzle-orm";

const BATCH_SIZE = 500;

async function exportRowsToNdjsonGz(
  rows: Record<string, unknown>[],
  outputPath: string,
): Promise<number> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const ndjson = rows.map((r) => JSON.stringify(r)).join("\n");
  const gz = createGzip();
  const out = createWriteStream(outputPath);
  await pipeline(Readable.from([ndjson]), gz, out);
  return rows.length;
}

export async function exportActivityLog(db: Db, workspaceDir: string): Promise<number> {
  const rows = await db.select().from(activityLog).orderBy(asc(activityLog.createdAt));
  return exportRowsToNdjsonGz(
    rows as Record<string, unknown>[],
    path.join(workspaceDir, "runtime", "activity-log.ndjson.gz"),
  );
}

export async function exportCostEvents(db: Db, workspaceDir: string): Promise<number> {
  const rows = await db.select().from(costEvents).orderBy(asc(costEvents.occurredAt));
  return exportRowsToNdjsonGz(
    rows as Record<string, unknown>[],
    path.join(workspaceDir, "runtime", "cost-events.ndjson.gz"),
  );
}

export async function exportHeartbeatRuns(db: Db, workspaceDir: string): Promise<number> {
  const rows = await db.select().from(heartbeatRuns).orderBy(asc(heartbeatRuns.startedAt));
  return exportRowsToNdjsonGz(
    rows as Record<string, unknown>[],
    path.join(workspaceDir, "runtime", "heartbeat-runs.ndjson.gz"),
  );
}

async function readNdjsonGz(filePath: string): Promise<Record<string, unknown>[]> {
  try {
    await stat(filePath);
  } catch {
    return [];
  }
  const chunks: Buffer[] = [];
  await pipeline(createReadStream(filePath), createGunzip(), async function* (source) {
    for await (const chunk of source) {
      chunks.push(chunk as Buffer);
    }
  });
  const text = Buffer.concat(chunks).toString("utf-8");
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

export interface RuntimeLogImportResult {
  activity: number;
  costs: number;
  heartbeats: number;
}

export async function importRuntimeLogs(db: Db, workspaceDir: string): Promise<RuntimeLogImportResult> {
  const activityRows = await readNdjsonGz(path.join(workspaceDir, "runtime", "activity-log.ndjson.gz"));
  const costRows = await readNdjsonGz(path.join(workspaceDir, "runtime", "cost-events.ndjson.gz"));
  const hbRows = await readNdjsonGz(path.join(workspaceDir, "runtime", "heartbeat-runs.ndjson.gz"));

  // Coerce timestamps back to Date objects so Drizzle accepts them
  const fixDates = (rows: Record<string, unknown>[]) =>
    rows.map((row) => {
      const fixed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
          fixed[k] = new Date(v);
        } else {
          fixed[k] = v;
        }
      }
      return fixed;
    });

  const activityFixed = fixDates(activityRows);
  const costFixed = fixDates(costRows);
  const hbFixed = fixDates(hbRows);

  for (let i = 0; i < activityFixed.length; i += BATCH_SIZE) {
    await db
      .insert(activityLog)
      .values(activityFixed.slice(i, i + BATCH_SIZE) as any)
      .onConflictDoNothing();
  }
  for (let i = 0; i < costFixed.length; i += BATCH_SIZE) {
    await db
      .insert(costEvents)
      .values(costFixed.slice(i, i + BATCH_SIZE) as any)
      .onConflictDoNothing();
  }
  for (let i = 0; i < hbFixed.length; i += BATCH_SIZE) {
    await db
      .insert(heartbeatRuns)
      .values(hbFixed.slice(i, i + BATCH_SIZE) as any)
      .onConflictDoNothing();
  }

  return { activity: activityFixed.length, costs: costFixed.length, heartbeats: hbFixed.length };
}
