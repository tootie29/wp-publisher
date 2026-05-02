// lib/fetch-queue.ts
// In-memory job queue used to ask the WP Publisher Connector browser
// extension to fetch URLs from the user's authenticated browser session.
// We do this for sources (Frase, sometimes Surfer) where headless Playwright
// gets bot-detected even with cookies + localStorage replayed.

import crypto from 'node:crypto';

export type FetchSource = 'surfer' | 'frase';

export interface FetchResult {
  html: string;
  title?: string;
}

interface Job {
  id: string;
  url: string;
  source: FetchSource;
  ownerKey: string;       // userKey of the user this job belongs to
  createdAt: number;
  resolve: (r: FetchResult) => void;
  reject: (e: Error) => void;
  takenAt?: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __wpFetchQueue:
    | { jobs: Map<string, Job>; pending: Job[] }
    | undefined;
}

function getStore(): { jobs: Map<string, Job>; pending: Job[] } {
  if (!globalThis.__wpFetchQueue) {
    globalThis.__wpFetchQueue = { jobs: new Map(), pending: [] };
  }
  return globalThis.__wpFetchQueue;
}

const TIMEOUT_MS = 60_000;

export function enqueueFetch(
  url: string,
  source: FetchSource,
  ownerKey: string
): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const store = getStore();
    const id = crypto.randomUUID();
    const job: Job = {
      id,
      url,
      source,
      ownerKey,
      createdAt: Date.now(),
      resolve,
      reject,
    };
    store.jobs.set(id, job);
    store.pending.push(job);

    setTimeout(() => {
      if (!store.jobs.has(id)) return;
      store.jobs.delete(id);
      const idx = store.pending.indexOf(job);
      if (idx >= 0) store.pending.splice(idx, 1);
      reject(
        new Error(
          'Browser extension did not respond within 60s. ' +
            'Make sure the WP Publisher Connector extension is installed, the dashboard tab is open, and you are logged in to ' +
            (source === 'frase' ? 'Frase' : 'Surfer SEO') +
            '.'
        )
      );
    }, TIMEOUT_MS);
  });
}

// Take the next job for a specific user. Each user's open dashboard tab only
// processes jobs that user enqueued, so cross-account fetches don't collide.
export function takeNextJobForOwner(
  ownerKey: string
): { id: string; url: string; source: FetchSource } | null {
  const store = getStore();
  // Find first pending job that matches ownerKey
  for (let i = 0; i < store.pending.length; i++) {
    const job = store.pending[i];
    if (!store.jobs.has(job.id)) {
      // Stale (timed out) — remove it
      store.pending.splice(i, 1);
      i--;
      continue;
    }
    if (job.ownerKey !== ownerKey) continue;
    store.pending.splice(i, 1);
    job.takenAt = Date.now();
    return { id: job.id, url: job.url, source: job.source };
  }
  return null;
}

export function completeJob(
  id: string,
  ownerKey: string,
  html?: string,
  error?: string,
  title?: string
): boolean {
  const store = getStore();
  const job = store.jobs.get(id);
  if (!job) return false;
  // Job result must come back from the same user that picked it up.
  if (job.ownerKey !== ownerKey) return false;
  store.jobs.delete(id);
  if (error) job.reject(new Error(error));
  else if (typeof html === 'string' && html.length > 0) job.resolve({ html, title });
  else job.reject(new Error('Empty response from extension'));
  return true;
}
