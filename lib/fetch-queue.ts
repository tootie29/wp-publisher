// lib/fetch-queue.ts
// In-memory job queue used to ask the WP Publisher Connector browser
// extension to fetch URLs from the user's authenticated browser session.
// We do this for sources (Frase, sometimes Surfer) where headless Playwright
// gets bot-detected even with cookies + localStorage replayed.

import crypto from 'node:crypto';

export type FetchSource = 'surfer' | 'frase';

interface Job {
  id: string;
  url: string;
  source: FetchSource;
  createdAt: number;
  resolve: (html: string) => void;
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

export function enqueueFetch(url: string, source: FetchSource): Promise<string> {
  return new Promise((resolve, reject) => {
    const store = getStore();
    const id = crypto.randomUUID();
    const job: Job = {
      id,
      url,
      source,
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

export function takeNextJob(): { id: string; url: string; source: FetchSource } | null {
  const store = getStore();
  // Pull jobs that haven't been handed out yet
  while (store.pending.length) {
    const job = store.pending.shift()!;
    if (!store.jobs.has(job.id)) continue; // timed out already
    job.takenAt = Date.now();
    return { id: job.id, url: job.url, source: job.source };
  }
  return null;
}

export function completeJob(id: string, html?: string, error?: string): boolean {
  const store = getStore();
  const job = store.jobs.get(id);
  if (!job) return false;
  store.jobs.delete(id);
  if (error) job.reject(new Error(error));
  else if (typeof html === 'string' && html.length > 0) job.resolve(html);
  else job.reject(new Error('Empty response from extension'));
  return true;
}
