// lib/connector.ts
// Postgres-backed storage for Surfer/Frase session cookies submitted by the
// browser extension. Encrypted with AES-256-GCM via APP_SECRET.
import { pool } from './db';
import { encryptSecret, decryptSecret } from './secret-crypto';

export type ConnectorSource = 'surfer' | 'frase';

export interface ConnectorCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'no_restriction' | 'lax' | 'strict' | 'unspecified';
  expirationDate?: number;
}

export interface ConnectorRecord {
  source: ConnectorSource;
  cookies: ConnectorCookie[];
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  savedAt: string;
}

export async function saveCookies(
  userKey: string,
  projectId: string,
  source: ConnectorSource,
  cookies: ConnectorCookie[],
  localStorage?: Record<string, string>,
  sessionStorage?: Record<string, string>
): Promise<void> {
  const record: ConnectorRecord = {
    source,
    cookies,
    localStorage:
      localStorage && Object.keys(localStorage).length ? localStorage : undefined,
    sessionStorage:
      sessionStorage && Object.keys(sessionStorage).length ? sessionStorage : undefined,
    savedAt: new Date().toISOString(),
  };
  const blob = encryptSecret(JSON.stringify(record));

  await pool.query(
    `INSERT INTO connector_cookies (user_key, project_id, source, encrypted_blob, saved_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_key, project_id, source) DO UPDATE SET
       encrypted_blob = EXCLUDED.encrypted_blob,
       saved_at       = NOW()`,
    [userKey, projectId, source, blob]
  );
}

export async function loadCookies(
  userKey: string,
  projectId: string,
  source: ConnectorSource
): Promise<ConnectorRecord | null> {
  // Per-user record first.
  const own = await pool.query<{ encrypted_blob: string }>(
    `SELECT encrypted_blob FROM connector_cookies
     WHERE user_key = $1 AND project_id = $2 AND source = $3`,
    [userKey, projectId, source]
  );
  if (own.rowCount && own.rows[0]) {
    return safeDecrypt(own.rows[0].encrypted_blob);
  }
  // Legacy shared record (any user_key) — read-only fallback so existing
  // connections keep working until users reconnect under their own account.
  const legacy = await pool.query<{ encrypted_blob: string }>(
    `SELECT encrypted_blob FROM connector_cookies
     WHERE project_id = $1 AND source = $2
     ORDER BY saved_at DESC
     LIMIT 1`,
    [projectId, source]
  );
  if (legacy.rowCount && legacy.rows[0]) {
    return safeDecrypt(legacy.rows[0].encrypted_blob);
  }
  return null;
}

export async function clearCookies(
  userKey: string,
  projectId: string,
  source: ConnectorSource
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM connector_cookies
     WHERE user_key = $1 AND project_id = $2 AND source = $3`,
    [userKey, projectId, source]
  );
  return (rowCount ?? 0) > 0;
}

function safeDecrypt(blob: string): ConnectorRecord | null {
  try {
    return JSON.parse(decryptSecret(blob)) as ConnectorRecord;
  } catch {
    return null;
  }
}

interface OneStatus {
  connected: boolean;
  ageSeconds?: number;
  cookieCount?: number;
  localStorageKeys?: number;
}

async function oneStatus(
  userKey: string,
  projectId: string,
  source: ConnectorSource
): Promise<OneStatus> {
  const r = await loadCookies(userKey, projectId, source);
  if (!r) return { connected: false };
  const ageSeconds = Math.floor((Date.now() - new Date(r.savedAt).getTime()) / 1000);
  return {
    connected: true,
    ageSeconds,
    cookieCount: r.cookies.length,
    localStorageKeys: r.localStorage ? Object.keys(r.localStorage).length : 0,
  };
}

export async function statusFor(userKey: string, projectId: string) {
  const [surfer, frase] = await Promise.all([
    oneStatus(userKey, projectId, 'surfer'),
    oneStatus(userKey, projectId, 'frase'),
  ]);
  return { surfer, frase };
}
