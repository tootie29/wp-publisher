// scripts/init-db.ts
// Applies any unrun SQL files in db/migrations/ in alphabetical order.
// Tracks applied filenames in a `schema_migrations` table.
//
// Usage:
//   DATABASE_URL=... npm run db:init
import './_env.js';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from '../lib/db.js';

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const dir = join(process.cwd(), 'db', 'migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No migration files found in db/migrations/.');
    return;
  }

  for (const filename of files) {
    const { rowCount } = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [filename]
    );
    if (rowCount && rowCount > 0) {
      console.log(`✓ ${filename} (already applied)`);
      continue;
    }

    const sql = readFileSync(join(dir, filename), 'utf8');
    console.log(`→ applying ${filename}…`);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [filename]
      );
      await client.query('COMMIT');
      console.log(`✓ ${filename}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
