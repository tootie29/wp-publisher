// lib/google.ts
// Service-account auth backed by the `service_account` Postgres row. The full
// JSON key is stored encrypted at rest (AES-256-GCM via APP_SECRET).
//
// For local-dev convenience this still falls back to the on-disk
// GOOGLE_SERVICE_ACCOUNT_KEY_FILE if no DB row exists, so existing setups keep
// working until they re-upload through the dashboard.
import { google } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import { pool } from './db';
import { decryptSecret, encryptSecret } from './secret-crypto';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
];

interface ServiceAccountKey {
  type: 'service_account';
  client_email: string;
  private_key: string;
  [k: string]: unknown;
}

let cached: { key: ServiceAccountKey; loadedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

async function loadServiceAccount(): Promise<ServiceAccountKey | null> {
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.key;
  }

  // 1. DB (preferred — works on Vercel)
  try {
    const { rows } = await pool.query<{ encrypted_blob: string }>(
      "SELECT encrypted_blob FROM service_account WHERE id = 'default'"
    );
    if (rows[0]) {
      const key = JSON.parse(decryptSecret(rows[0].encrypted_blob)) as ServiceAccountKey;
      cached = { key, loadedAt: Date.now() };
      return key;
    }
  } catch {
    // fall through to file fallback
  }

  // 2. File fallback (legacy / local dev)
  try {
    const p = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || './config/service-account.json';
    const full = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
    if (fs.existsSync(full)) {
      const key = JSON.parse(fs.readFileSync(full, 'utf8')) as ServiceAccountKey;
      cached = { key, loadedAt: Date.now() };
      return key;
    }
  } catch {
    // ignore
  }

  return null;
}

export async function getAuth() {
  const key = await loadServiceAccount();
  if (!key) {
    throw new Error(
      'No Google service account configured. Upload one via the Setup page.'
    );
  }
  return new google.auth.GoogleAuth({ credentials: key, scopes: SCOPES });
}

export async function getServiceAccountEmail(): Promise<string | null> {
  const key = await loadServiceAccount();
  return key?.client_email ?? null;
}

export async function saveServiceAccount(key: ServiceAccountKey): Promise<void> {
  const blob = encryptSecret(JSON.stringify(key));
  await pool.query(
    `INSERT INTO service_account (id, client_email, encrypted_blob, uploaded_at)
     VALUES ('default', $1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET
       client_email   = EXCLUDED.client_email,
       encrypted_blob = EXCLUDED.encrypted_blob,
       uploaded_at    = NOW()`,
    [key.client_email, blob]
  );
  cached = { key, loadedAt: Date.now() };
}

export async function deleteServiceAccount(): Promise<void> {
  await pool.query("DELETE FROM service_account WHERE id = 'default'");
  cached = null;
}

export async function hasServiceAccount(): Promise<boolean> {
  return (await loadServiceAccount()) !== null;
}
