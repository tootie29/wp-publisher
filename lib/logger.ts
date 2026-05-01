// lib/logger.ts
import fs from 'node:fs';
import path from 'node:path';
import type { LogEntry, LogLevel } from './types';

const LOG_DIR = path.join(process.cwd(), 'logs');

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

export function log(
  projectId: string,
  level: LogLevel,
  message: string,
  meta: Record<string, unknown> = {},
  rowIndex?: number
) {
  ensureDir();
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    projectId,
    rowIndex,
    level,
    message,
    meta,
  };
  const file = path.join(LOG_DIR, `${projectId}.jsonl`);
  fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  // Also echo to console
  const tag = `[${projectId}${rowIndex ? `:row ${rowIndex}` : ''}]`;
  // eslint-disable-next-line no-console
  console.log(`${tag} ${level.toUpperCase()}: ${message}`, meta);
}

export function readLogs(projectId: string, limit = 200): LogEntry[] {
  ensureDir();
  const file = path.join(LOG_DIR, `${projectId}.jsonl`);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  return lines
    .slice(-limit)
    .map((l) => {
      try { return JSON.parse(l) as LogEntry; } catch { return null; }
    })
    .filter((x): x is LogEntry => !!x)
    .reverse();
}

export function readAllLogs(limit = 500): LogEntry[] {
  ensureDir();
  if (!fs.existsSync(LOG_DIR)) return [];
  const files = fs.readdirSync(LOG_DIR).filter((f) => f.endsWith('.jsonl'));
  const all: LogEntry[] = [];
  for (const f of files) {
    const lines = fs
      .readFileSync(path.join(LOG_DIR, f), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean);
    for (const l of lines) {
      try { all.push(JSON.parse(l)); } catch {}
    }
  }
  return all.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, limit);
}
