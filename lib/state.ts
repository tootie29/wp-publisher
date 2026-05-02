// lib/state.ts
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');

export interface ProcessedRecord {
  projectId: string;
  rowIndex: number;
  wpId: number;
  wpLink: string;      // public URL
  editLink: string;    // wp-admin edit URL
  processedAt: string;
  sourceLink: string;
  title: string;
  pageType: string;
  route: 'post' | 'page';
  primaryKeyword: string;
  status: 'success' | 'partial'; // partial = WP created but sheet writeback failed
}

function file(projectId: string) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  return path.join(DATA_DIR, `${projectId}.processed.json`);
}

export function getProcessed(projectId: string): ProcessedRecord[] {
  const f = file(projectId);
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; }
}

export function hasProcessed(projectId: string, rowIndex: number): boolean {
  return getProcessed(projectId).some((r) => r.rowIndex === rowIndex);
}

export function getProcessedRecord(
  projectId: string,
  rowIndex: number
): ProcessedRecord | null {
  return getProcessed(projectId).find((r) => r.rowIndex === rowIndex) ?? null;
}

export function removeProcessed(projectId: string, rowIndex: number): boolean {
  const all = getProcessed(projectId);
  const next = all.filter((r) => r.rowIndex !== rowIndex);
  if (next.length === all.length) return false;
  fs.writeFileSync(file(projectId), JSON.stringify(next, null, 2));
  return true;
}

export function markProcessed(rec: ProcessedRecord) {
  const all = getProcessed(rec.projectId);
  all.push(rec);
  fs.writeFileSync(file(rec.projectId), JSON.stringify(all, null, 2));
}

// Most recent first
export function recentProcessed(projectId: string, limit = 50): ProcessedRecord[] {
  return getProcessed(projectId)
    .slice()
    .sort((a, b) => b.processedAt.localeCompare(a.processedAt))
    .slice(0, limit);
}

// Last run summary
export interface RunSummary {
  lastRunAt: string | null;
  recentSuccessCount: number;    // published in last hour
  totalPublished: number;
}

export function runSummary(projectId: string): RunSummary {
  const all = getProcessed(projectId);
  if (all.length === 0) return { lastRunAt: null, recentSuccessCount: 0, totalPublished: 0 };
  const sorted = all.slice().sort((a, b) => b.processedAt.localeCompare(a.processedAt));
  const lastRunAt = sorted[0].processedAt;
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const recentSuccessCount = all.filter(
    (r) => new Date(r.processedAt).getTime() > hourAgo
  ).length;
  return { lastRunAt, recentSuccessCount, totalPublished: all.length };
}
