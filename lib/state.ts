// lib/state.ts
// Postgres-backed processed-row ledger. Replaces data/<id>.processed.json.
import { pool } from './db';

export interface ProcessedRecord {
  projectId: string;
  rowIndex: number;
  wpId: number;
  wpLink: string;      // public URL
  editLink: string;    // wp-admin edit URL
  processedAt: string; // ISO timestamp
  sourceLink: string;
  title: string;
  pageType: string;
  route: 'post' | 'page';
  primaryKeyword: string;
  status: 'success' | 'partial'; // partial = WP created but sheet writeback failed
  scheduledFor?: string;         // ISO date we stamped on a scheduled blog draft
}

interface ProcessedRow {
  project_id: string;
  row_index: number;
  wp_id: number;
  wp_link: string;
  edit_link: string;
  processed_at: Date;
  source_link: string;
  title: string;
  page_type: string;
  route: 'post' | 'page';
  primary_keyword: string;
  status: 'success' | 'partial';
  scheduled_for: Date | null;
}

function rowToRecord(r: ProcessedRow): ProcessedRecord {
  return {
    projectId: r.project_id,
    rowIndex: r.row_index,
    wpId: r.wp_id,
    wpLink: r.wp_link,
    editLink: r.edit_link,
    processedAt: r.processed_at.toISOString(),
    sourceLink: r.source_link,
    title: r.title,
    pageType: r.page_type,
    route: r.route,
    primaryKeyword: r.primary_keyword,
    status: r.status,
    scheduledFor: r.scheduled_for ? r.scheduled_for.toISOString() : undefined,
  };
}

export async function getProcessed(projectId: string): Promise<ProcessedRecord[]> {
  const { rows } = await pool.query<ProcessedRow>(
    'SELECT * FROM processed_rows WHERE project_id = $1 ORDER BY processed_at DESC',
    [projectId]
  );
  return rows.map(rowToRecord);
}

export async function hasProcessed(projectId: string, rowIndex: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM processed_rows WHERE project_id = $1 AND row_index = $2',
    [projectId, rowIndex]
  );
  return (rowCount ?? 0) > 0;
}

export async function getProcessedRecord(
  projectId: string,
  rowIndex: number
): Promise<ProcessedRecord | null> {
  const { rows } = await pool.query<ProcessedRow>(
    'SELECT * FROM processed_rows WHERE project_id = $1 AND row_index = $2',
    [projectId, rowIndex]
  );
  if (!rows.length) return null;
  return rowToRecord(rows[0]);
}

export async function removeProcessed(projectId: string, rowIndex: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM processed_rows WHERE project_id = $1 AND row_index = $2',
    [projectId, rowIndex]
  );
  return (rowCount ?? 0) > 0;
}

export async function clearProcessed(projectId: string): Promise<number> {
  const { rowCount } = await pool.query(
    'DELETE FROM processed_rows WHERE project_id = $1',
    [projectId]
  );
  return rowCount ?? 0;
}

export async function markProcessed(rec: ProcessedRecord): Promise<void> {
  await pool.query(
    `INSERT INTO processed_rows (
      project_id, row_index, wp_id, wp_link, edit_link, processed_at,
      source_link, title, page_type, route, primary_keyword, status, scheduled_for
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (project_id, row_index) DO UPDATE SET
      wp_id           = EXCLUDED.wp_id,
      wp_link         = EXCLUDED.wp_link,
      edit_link       = EXCLUDED.edit_link,
      processed_at    = EXCLUDED.processed_at,
      source_link     = EXCLUDED.source_link,
      title           = EXCLUDED.title,
      page_type       = EXCLUDED.page_type,
      route           = EXCLUDED.route,
      primary_keyword = EXCLUDED.primary_keyword,
      status          = EXCLUDED.status,
      scheduled_for   = EXCLUDED.scheduled_for`,
    [
      rec.projectId,
      rec.rowIndex,
      rec.wpId,
      rec.wpLink,
      rec.editLink,
      rec.processedAt,
      rec.sourceLink,
      rec.title,
      rec.pageType,
      rec.route,
      rec.primaryKeyword,
      rec.status,
      rec.scheduledFor ?? null,
    ]
  );
}

// The latest future publish slot we've stamped on a blog (post-route) draft.
// Lets the next blog space off our own queued drafts, which aren't visible in
// the WP publish/future query because they're still drafts.
export async function latestScheduledBlogDate(projectId: string): Promise<Date | null> {
  const { rows } = await pool.query<{ latest: Date | null }>(
    `SELECT MAX(scheduled_for) AS latest
     FROM processed_rows
     WHERE project_id = $1 AND route = 'post' AND scheduled_for IS NOT NULL`,
    [projectId]
  );
  return rows[0]?.latest ?? null;
}

export async function recentProcessed(
  projectId: string,
  limit = 50
): Promise<ProcessedRecord[]> {
  const { rows } = await pool.query<ProcessedRow>(
    `SELECT * FROM processed_rows
     WHERE project_id = $1
     ORDER BY processed_at DESC
     LIMIT $2`,
    [projectId, limit]
  );
  return rows.map(rowToRecord);
}

export interface RunSummary {
  lastRunAt: string | null;
  recentSuccessCount: number;    // published in last hour
  totalPublished: number;
}

export async function runSummary(projectId: string): Promise<RunSummary> {
  const { rows } = await pool.query<{
    last_run_at: Date | null;
    recent: string;
    total: string;
  }>(
    `SELECT
       MAX(processed_at) AS last_run_at,
       COUNT(*) FILTER (WHERE processed_at > NOW() - INTERVAL '1 hour') AS recent,
       COUNT(*) AS total
     FROM processed_rows WHERE project_id = $1`,
    [projectId]
  );
  const r = rows[0];
  return {
    lastRunAt: r.last_run_at ? r.last_run_at.toISOString() : null,
    recentSuccessCount: parseInt(r.recent, 10) || 0,
    totalPublished: parseInt(r.total, 10) || 0,
  };
}
