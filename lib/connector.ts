// lib/connector.ts
// Encrypted at-rest storage for Surfer/Frase session cookies submitted by the
// browser extension. AES-256-GCM, key derived from APP_SECRET.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

interface EncryptedFile {
  v: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

const dataDir = (() => {
  const env = process.env.DATA_DIR;
  if (env) return path.isAbsolute(env) ? env : path.join(process.cwd(), env);
  return path.join(process.cwd(), 'data');
})();

function dirFor(userKey: string, projectId: string): string {
  return path.join(dataDir, 'connector', userKey, projectId);
}

function fileFor(userKey: string, projectId: string, source: ConnectorSource): string {
  return path.join(dirFor(userKey, projectId), `${source}.enc.json`);
}

// Legacy path used before per-user isolation. Read-only fallback so existing
// connections continue to work until users reconnect.
function legacyFile(projectId: string, source: ConnectorSource): string {
  return path.join(dataDir, 'connector', projectId, `${source}.enc.json`);
}

function getKey(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error('APP_SECRET is not set — required for connector cookie encryption');
  // Derive a 32-byte key from APP_SECRET. SHA-256 of the secret is fine for
  // this purpose (single-tenant, key isn't shared with attackers).
  return crypto.createHash('sha256').update(secret).digest();
}

export function saveCookies(
  userKey: string,
  projectId: string,
  source: ConnectorSource,
  cookies: ConnectorCookie[],
  localStorage?: Record<string, string>,
  sessionStorage?: Record<string, string>
): void {
  fs.mkdirSync(dirFor(userKey, projectId), { recursive: true });

  const record: ConnectorRecord = {
    source,
    cookies,
    localStorage: localStorage && Object.keys(localStorage).length ? localStorage : undefined,
    sessionStorage: sessionStorage && Object.keys(sessionStorage).length ? sessionStorage : undefined,
    savedAt: new Date().toISOString(),
  };

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(record), 'utf8');
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const out: EncryptedFile = {
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ct.toString('base64'),
  };

  fs.writeFileSync(fileFor(userKey, projectId, source), JSON.stringify(out));
}

function readEncrypted(filePath: string): ConnectorRecord | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as EncryptedFile;
    const iv = Buffer.from(raw.iv, 'base64');
    const tag = Buffer.from(raw.tag, 'base64');
    const ct = Buffer.from(raw.ciphertext, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString('utf8')) as ConnectorRecord;
  } catch {
    return null;
  }
}

export function loadCookies(
  userKey: string,
  projectId: string,
  source: ConnectorSource
): ConnectorRecord | null {
  // Per-user record first, then legacy shared record.
  return (
    readEncrypted(fileFor(userKey, projectId, source)) ||
    readEncrypted(legacyFile(projectId, source))
  );
}

export function clearCookies(
  userKey: string,
  projectId: string,
  source: ConnectorSource
): boolean {
  const f = fileFor(userKey, projectId, source);
  if (fs.existsSync(f)) {
    fs.unlinkSync(f);
    return true;
  }
  return false;
}

export function statusFor(userKey: string, projectId: string) {
  return {
    surfer: oneStatus(userKey, projectId, 'surfer'),
    frase: oneStatus(userKey, projectId, 'frase'),
  };
}

function oneStatus(
  userKey: string,
  projectId: string,
  source: ConnectorSource
): {
  connected: boolean;
  ageSeconds?: number;
  cookieCount?: number;
  localStorageKeys?: number;
} {
  const r = loadCookies(userKey, projectId, source);
  if (!r) return { connected: false };
  const ageSeconds = Math.floor((Date.now() - new Date(r.savedAt).getTime()) / 1000);
  return {
    connected: true,
    ageSeconds,
    cookieCount: r.cookies.length,
    localStorageKeys: r.localStorage ? Object.keys(r.localStorage).length : 0,
  };
}
