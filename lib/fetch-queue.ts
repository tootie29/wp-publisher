// lib/fetch-queue.ts
// Postgres-backed job queue for asking the WP Publisher Connector browser
// extension to fetch URLs from the user's authenticated browser session.
// Used for sources (Frase, Surfer) where headless Playwright either gets
// bot-detected or isn't available (e.g. Vercel serverless).
//
// The queue lives in Postgres so the worker's `enqueueFetch` and the
// extension's poll endpoint can run in separate serverless invocations and
// still see each other.

import crypto from 'node:crypto';
import { pool } from './db';

export type FetchSource = 'surfer' | 'frase';

export interface FetchResult {
  html: string;
  title?: string;
}

const TIMEOUT_MS = 60_000;
const POLL_MS = 1000;

export async function enqueueFetch(
  url: string,
  source: FetchSource,
  ownerKey: string
): Promise<FetchResult> {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO fetch_jobs (id, url, source, owner_key, status)
     VALUES ($1, $2, $3, $4, 'pending')`,
    [id, url, source, ownerKey]
  );

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const r = await pool.query<{
      status: string;
      result_html: string | null;
      result_title: string | null;
      error: string | null;
    }>(
      `SELECT status, result_html, result_title, error
       FROM fetch_jobs WHERE id = $1`,
      [id]
    );
    const row = r.rows[0];
    if (!row) break;
    if (row.status === 'completed') {
      return {
        html: row.result_html || '',
        title: row.result_title || undefined,
      };
    }
    if (row.status === 'failed') {
      throw new Error(row.error || 'Extension reported an error');
    }
    await sleep(POLL_MS);
  }

  // Timed out — mark as failed so subsequent reads see a terminal state.
  await pool.query(
    `UPDATE fetch_jobs SET status='failed', error='timed out waiting for extension', completed_at=NOW()
     WHERE id = $1 AND status IN ('pending','taken')`,
    [id]
  );
  throw new Error(
    'Browser extension did not respond within 60s. ' +
      'Make sure the WP Publisher Connector extension is installed, the dashboard tab is open, and you are logged in to ' +
      (source === 'frase' ? 'Frase' : 'Surfer SEO') +
      '.'
  );
}

// Atomically claim the oldest pending job for the requesting user.
// FOR UPDATE SKIP LOCKED prevents two concurrent extension polls (multiple
// open dashboard tabs in the same browser) from grabbing the same job.
export async function takeNextJobForOwner(
  ownerKey: string
): Promise<{ id: string; url: string; source: FetchSource } | null> {
  const r = await pool.query<{
    id: string;
    url: string;
    source: FetchSource;
  }>(
    `UPDATE fetch_jobs SET status='taken', taken_at=NOW()
     WHERE id = (
       SELECT id FROM fetch_jobs
       WHERE owner_key = $1 AND status = 'pending'
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, url, source`,
    [ownerKey]
  );
  return r.rows[0] || null;
}

export async function completeJob(
  id: string,
  ownerKey: string,
  html?: string,
  error?: string,
  title?: string
): Promise<boolean> {
  if (error) {
    const r = await pool.query(
      `UPDATE fetch_jobs SET status='failed', error=$3, completed_at=NOW()
       WHERE id=$1 AND owner_key=$2 AND status='taken'`,
      [id, ownerKey, error]
    );
    return (r.rowCount ?? 0) > 0;
  }
  if (typeof html === 'string' && html.length > 0) {
    const r = await pool.query(
      `UPDATE fetch_jobs SET status='completed', result_html=$3, result_title=$4, completed_at=NOW()
       WHERE id=$1 AND owner_key=$2 AND status='taken'`,
      [id, ownerKey, html, title || null]
    );
    return (r.rowCount ?? 0) > 0;
  }
  const r = await pool.query(
    `UPDATE fetch_jobs SET status='failed', error='Empty response from extension', completed_at=NOW()
     WHERE id=$1 AND owner_key=$2 AND status='taken'`,
    [id, ownerKey]
  );
  return (r.rowCount ?? 0) > 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
