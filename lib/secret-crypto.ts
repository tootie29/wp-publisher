// lib/secret-crypto.ts
// AES-256-GCM helpers for encrypting at-rest secrets (e.g. WP app passwords)
// using APP_SECRET as the key material. Same convention as lib/connector.ts.
import crypto from 'node:crypto';

function getKey(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    throw new Error('APP_SECRET is not set — required for at-rest secret encryption');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

export function decryptSecret(packed: string): string {
  const parts = packed.split('.');
  if (parts.length !== 3) throw new Error('Malformed encrypted secret');
  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
