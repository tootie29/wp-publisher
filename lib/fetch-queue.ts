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
export type FetchKind = 'content' | 'image';

export interface FetchResult {
  html: string;
  title?: string;
}

export interface ImageFetchResult {
  dataBase64: string;
  contentType: string;
}

// Allow for a slow Surfer/Frase SPA: the extension waits up to ~35s for nav
// plus ~45s for the editor to render before scraping, so the server must wait
// longer than that for the job to come back. Safe now that the worker function
// runs up to 300s.
const TIMEOUT_MS = 120_000;
const IMAGE_TIMEOUT_MS = 30_000;
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

// Ask the extension to fetch raw image bytes from the user's authenticated
// session. Used as a fallback when the server can't download an image directly
// (e.g. Surfer/Frase serve it only to the logged-in browser). Returns base64
// bytes + MIME type.
export async function enqueueImageFetch(
  url: string,
  source: FetchSource,
  ownerKey: string
): Promise<ImageFetchResult> {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO fetch_jobs (id, url, source, owner_key, status, kind)
     VALUES ($1, $2, $3, $4, 'pending', 'image')`,
    [id, url, source, ownerKey]
  );

  const deadline = Date.now() + IMAGE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const r = await pool.query<{
      status: string;
      result_html: string | null;
      result_content_type: string | null;
      error: string | null;
    }>(
      `SELECT status, result_html, result_content_type, error
       FROM fetch_jobs WHERE id = $1`,
      [id]
    );
    const row = r.rows[0];
    if (!row) break;
    if (row.status === 'completed') {
      return {
        dataBase64: row.result_html || '',
        contentType: row.result_content_type || 'application/octet-stream',
      };
    }
    if (row.status === 'failed') {
      throw new Error(row.error || 'Extension reported an error');
    }
    await sleep(POLL_MS);
  }

  await pool.query(
    `UPDATE fetch_jobs SET status='failed', error='timed out waiting for extension', completed_at=NOW()
     WHERE id = $1 AND status IN ('pending','taken')`,
    [id]
  );
  throw new Error(
    `Browser extension did not return the image within ${IMAGE_TIMEOUT_MS / 1000}s.`
  );
}

// Atomically claim the oldest pending job for the requesting user.
// FOR UPDATE SKIP LOCKED prevents two concurrent extension polls (multiple
// open dashboard tabs in the same browser) from grabbing the same job.
export async function takeNextJobForOwner(
  ownerKey: string
): Promise<{ id: string; url: string; source: FetchSource; kind: FetchKind } | null> {
  const r = await pool.query<{
    id: string;
    url: string;
    source: FetchSource;
    kind: FetchKind;
  }>(
    `UPDATE fetch_jobs SET status='taken', taken_at=NOW()
     WHERE id = (
       SELECT id FROM fetch_jobs
       WHERE owner_key = $1 AND status = 'pending'
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, url, source, kind`,
    [ownerKey]
  );
  return r.rows[0] || null;
}

export interface CompletePayload {
  html?: string;
  title?: string;
  dataBase64?: string;
  contentType?: string;
  error?: string;
}

export async function completeJob(
  id: string,
  ownerKey: string,
  payload: CompletePayload
): Promise<boolean> {
  const { html, title, dataBase64, contentType, error } = payload;

  if (error) {
    const r = await pool.query(
      `UPDATE fetch_jobs SET status='failed', error=$3, completed_at=NOW()
       WHERE id=$1 AND owner_key=$2 AND status='taken'`,
      [id, ownerKey, error]
    );
    return (r.rowCount ?? 0) > 0;
  }
  // Image job — base64 bytes stashed in result_html, MIME in result_content_type.
  if (typeof dataBase64 === 'string' && dataBase64.length > 0) {
    const r = await pool.query(
      `UPDATE fetch_jobs SET status='completed', result_html=$3, result_content_type=$4, completed_at=NOW()
       WHERE id=$1 AND owner_key=$2 AND status='taken'`,
      [id, ownerKey, dataBase64, contentType || null]
    );
    return (r.rowCount ?? 0) > 0;
  }
  // Content job — scraped article HTML.
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
