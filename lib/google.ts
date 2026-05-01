// lib/google.ts
import { google } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
];

function resolveKeyFile(): string {
  const p = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || './config/service-account.json';
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

export function getAuth() {
  const keyFile = resolveKeyFile();
  if (!fs.existsSync(keyFile)) {
    throw new Error(
      `Service account key not found at ${keyFile}. Set GOOGLE_SERVICE_ACCOUNT_KEY_FILE or place the file there.`
    );
  }
  return new google.auth.GoogleAuth({ keyFile, scopes: SCOPES });
}

export function getServiceAccountEmail(): string | null {
  try {
    const raw = fs.readFileSync(resolveKeyFile(), 'utf8');
    return (JSON.parse(raw) as { client_email?: string }).client_email ?? null;
  } catch {
    return null;
  }
}
