// lib/logger.ts
// Postgres-backed logging. Writes are fire-and-forget so existing call sites
// stay synchronous; the worker pipeline has many awaits between log calls,
// giving inserts time to flush before the request returns. Reads are async.
import { pool } from './db';
import type { LogEntry, LogLevel } from './types';

interface LogRow {
  ts: Date;
  project_id: string;
  row_index: number | null;
  level: LogLevel;
  message: string;
  meta: Record<string, unknown>;
}

function rowToEntry(r: LogRow): LogEntry {
  return {
    ts: r.ts.toISOString(),
    projectId: r.project_id,
    rowIndex: r.row_index ?? undefined,
    level: r.level,
    message: r.message,
    meta: r.meta,
  };
}

export function log(
  projectId: string,
  level: LogLevel,
  message: string,
  meta: Record<string, unknown> = {},
  rowIndex?: number
): void {
  // Console echo first — useful even if the DB write fails or hasn't flushed.
  const tag = `[${projectId}${rowIndex ? `:row ${rowIndex}` : ''}]`;
  // eslint-disable-next-line no-console
  console.log(`${tag} ${level.toUpperCase()}: ${message}`, meta);

  // Fire-and-forget DB write. Errors are swallowed so a logging failure can't
  // crash the worker pipeline — the console line above is the durable record.
  pool
    .query(
      `INSERT INTO logs (project_id, row_index, level, message, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [projectId, rowIndex ?? null, level, message, JSON.stringify(meta)]
    )
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error(`[logger] insert failed: ${(e as Error).message}`);
    });
}

export async function readLogs(projectId: string, limit = 200): Promise<LogEntry[]> {
  const { rows } = await pool.query<LogRow>(
    `SELECT ts, project_id, row_index, level, message, meta
     FROM logs WHERE project_id = $1
     ORDER BY ts DESC
     LIMIT $2`,
    [projectId, limit]
  );
  return rows.map(rowToEntry);
}

export async function readAllLogs(limit = 500): Promise<LogEntry[]> {
  const { rows } = await pool.query<LogRow>(
    `SELECT ts, project_id, row_index, level, message, meta
     FROM logs
     ORDER BY ts DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map(rowToEntry);
}
