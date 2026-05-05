// scripts/migrate-state-to-db.ts
// Imports the remaining on-disk state into Postgres:
//   data/<id>.processed.json                       → processed_rows
//   logs/<id>.jsonl                                → logs
//   data/connector/<userKey>/<id>/*.enc.json       → connector_cookies
//   config/service-account.json                    → service_account
//
// Idempotent — safe to re-run. Uses ON CONFLICT to skip rows already imported.
//
// Usage:
//   DATABASE_URL=... APP_SECRET=... npm run db:migrate-state
import './_env.js';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { pool } from '../lib/db.js';
import { encryptSecret } from '../lib/secret-crypto.js';
import { saveServiceAccount } from '../lib/google.js';
import type { LogEntry } from '../lib/types.js';

interface ProcessedRecord {
  projectId: string;
  rowIndex: number;
  wpId: number;
  wpLink: string;
  editLink: string;
  processedAt: string;
  sourceLink: string;
  title: string;
  pageType: string;
  route: 'post' | 'page';
  primaryKeyword: string;
  status: 'success' | 'partial';
}

interface OldConnectorBlob {
  v: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

const dataDir =
  process.env.DATA_DIR && process.env.DATA_DIR.trim()
    ? process.env.DATA_DIR
    : './data';
const dataAbs = join(process.cwd(), dataDir);
const logsDir = join(process.cwd(), 'logs');
const configDir = join(process.cwd(), 'config');

function appKey(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error('APP_SECRET is required to migrate connector cookies');
  return crypto.createHash('sha256').update(secret).digest();
}

function decryptOldConnector(blob: OldConnectorBlob): string {
  const iv = Buffer.from(blob.iv, 'base64');
  const tag = Buffer.from(blob.tag, 'base64');
  const ct = Buffer.from(blob.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', appKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

async function migrateProcessed(): Promise<void> {
  console.log('\n— processed_rows —');
  if (!existsSync(dataAbs)) {
    console.log('  no data dir, skipping');
    return;
  }
  const files = readdirSync(dataAbs).filter((f) => f.endsWith('.processed.json'));
  if (!files.length) {
    console.log('  no .processed.json files');
    return;
  }
  let inserted = 0;
  let skipped = 0;
  for (const f of files) {
    const projectId = f.replace(/\.processed\.json$/, '');
    let recs: ProcessedRecord[];
    try {
      recs = JSON.parse(readFileSync(join(dataAbs, f), 'utf8'));
    } catch {
      console.warn(`  ! ${f}: invalid JSON, skipped`);
      continue;
    }
    for (const r of recs) {
      const result = await pool.query(
        `INSERT INTO processed_rows (
          project_id, row_index, wp_id, wp_link, edit_link, processed_at,
          source_link, title, page_type, route, primary_keyword, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (project_id, row_index) DO NOTHING`,
        [
          projectId,
          r.rowIndex,
          r.wpId,
          r.wpLink,
          r.editLink,
          r.processedAt,
          r.sourceLink,
          r.title,
          r.pageType,
          r.route,
          r.primaryKeyword,
          r.status,
        ]
      );
      if (result.rowCount === 1) inserted++;
      else skipped++;
    }
    console.log(`  ${f}: ${recs.length} record(s)`);
  }
  console.log(`  inserted ${inserted}, skipped ${skipped}`);
}

async function migrateLogs(): Promise<void> {
  console.log('\n— logs —');
  if (!existsSync(logsDir)) {
    console.log('  no logs dir, skipping');
    return;
  }
  const files = readdirSync(logsDir).filter((f) => f.endsWith('.jsonl'));
  if (!files.length) {
    console.log('  no .jsonl files');
    return;
  }
  let inserted = 0;
  for (const f of files) {
    const lines = readFileSync(join(logsDir, f), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      let entry: LogEntry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      // No natural unique key on logs — we accept duplicates on re-run, so
      // print a clear notice and only run this once.
      await pool.query(
        `INSERT INTO logs (ts, project_id, row_index, level, message, meta)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          entry.ts,
          entry.projectId,
          entry.rowIndex ?? null,
          entry.level,
          entry.message,
          JSON.stringify(entry.meta ?? {}),
        ]
      );
      inserted++;
    }
    console.log(`  ${f}: imported ${lines.length} line(s)`);
  }
  console.log(`  inserted ${inserted} log entries (re-running will duplicate)`);
}

async function migrateConnector(): Promise<void> {
  console.log('\n— connector_cookies —');
  const root = join(dataAbs, 'connector');
  if (!existsSync(root)) {
    console.log('  no connector dir, skipping');
    return;
  }
  let inserted = 0;
  let skipped = 0;
  // Layout 1 (per-user): data/connector/<userKey>/<projectId>/<source>.enc.json
  // Layout 2 (legacy):    data/connector/<projectId>/<source>.enc.json
  for (const top of readdirSync(root)) {
    const topPath = join(root, top);
    if (!statSync(topPath).isDirectory()) continue;
    const inner = readdirSync(topPath);
    // Heuristic: if `top` is a userKey, the next level holds projectIds (dirs).
    // If `top` is a projectId, the next level is files (.enc.json).
    const looksLikeUserKey = inner.some(
      (name) => statSync(join(topPath, name)).isDirectory()
    );
    if (looksLikeUserKey) {
      const userKey = top;
      for (const projectId of inner) {
        const pdir = join(topPath, projectId);
        if (!statSync(pdir).isDirectory()) continue;
        for (const fname of readdirSync(pdir)) {
          await ingestConnectorFile(join(pdir, fname), userKey, projectId, fname).then(
            (n) => { if (n === 1) inserted++; else skipped++; }
          );
        }
      }
    } else {
      // legacy: top = projectId, no userKey — store under '__legacy__'
      const projectId = top;
      for (const fname of inner) {
        await ingestConnectorFile(join(topPath, fname), '__legacy__', projectId, fname).then(
          (n) => { if (n === 1) inserted++; else skipped++; }
        );
      }
    }
  }
  console.log(`  inserted ${inserted}, skipped ${skipped}`);
}

async function ingestConnectorFile(
  filePath: string,
  userKey: string,
  projectId: string,
  fname: string
): Promise<number> {
  const m = fname.match(/^(surfer|frase)\.enc\.json$/);
  if (!m) return 0;
  const source = m[1] as 'surfer' | 'frase';
  let plain: string;
  try {
    const blob = JSON.parse(readFileSync(filePath, 'utf8')) as OldConnectorBlob;
    plain = decryptOldConnector(blob);
  } catch (e) {
    console.warn(`  ! ${filePath}: decrypt failed (${(e as Error).message})`);
    return 0;
  }
  const newBlob = encryptSecret(plain);
  const r = await pool.query(
    `INSERT INTO connector_cookies (user_key, project_id, source, encrypted_blob)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_key, project_id, source) DO NOTHING`,
    [userKey, projectId, source, newBlob]
  );
  return r.rowCount === 1 ? 1 : -1;
}

async function migrateServiceAccount(): Promise<void> {
  console.log('\n— service_account —');
  const file =
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE ||
    join(configDir, 'service-account.json');
  const full = file.startsWith('/') ? file : join(process.cwd(), file);
  if (!existsSync(full)) {
    console.log('  no key file, skipping');
    return;
  }
  const existing = await pool.query("SELECT 1 FROM service_account WHERE id = 'default'");
  if (existing.rowCount && existing.rowCount > 0) {
    console.log('  already imported, skipping');
    return;
  }
  const key = JSON.parse(readFileSync(full, 'utf8'));
  if (key.type !== 'service_account' || !key.client_email || !key.private_key) {
    console.warn('  ! file does not look like a service account key');
    return;
  }
  await saveServiceAccount(key);
  console.log(`  imported (${key.client_email})`);
}

async function main() {
  await migrateProcessed();
  await migrateLogs();
  await migrateConnector();
  await migrateServiceAccount();
  console.log('\nDone.');
}

main()
  .catch((e) => {
    console.error('\nMigration failed:', e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
