// lib/db.ts
// Postgres connection pool. Reused across hot-reloads in dev via globalThis.
import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function makePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  // pg does not auto-honor sslmode in URLs — flip ssl on if the URL asks for it
  // or the host is one of the common managed providers.
  const needsSsl =
    /sslmode=require/i.test(connectionString) ||
    /(neon\.tech|supabase\.co|vercel-storage\.com|amazonaws\.com|render\.com)/i.test(connectionString);

  return new Pool({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    // Keep the per-pool ceiling low — on Vercel every cold-started lambda
    // creates its own pool, and Neon's free tier caps concurrent connections.
    max: 5,
    idleTimeoutMillis: 10_000,
  });
}

export const pool: Pool = globalThis.__pgPool ?? makePool();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__pgPool = pool;
}
