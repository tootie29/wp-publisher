// scripts/migrate-json-to-db.ts
// One-time importer: copies every config/projects/*.json file into the
// `projects` table, encrypting the WP app password via APP_SECRET.
//
// Safe to run repeatedly — uses ON CONFLICT (id) DO NOTHING so existing rows
// won't be overwritten. Delete the row in the DB if you want to re-import.
//
// Usage:
//   DATABASE_URL=... APP_SECRET=... npm run db:migrate-json
import './_env.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from '../lib/db.js';
import { encryptSecret } from '../lib/secret-crypto.js';
import type { ProjectConfig } from '../lib/types.js';

async function main() {
  const dir = join(process.cwd(), 'config', 'projects');
  if (!existsSync(dir)) {
    console.log('No config/projects/ directory — nothing to migrate.');
    return;
  }

  const files = readdirSync(dir).filter(
    (f) => f.endsWith('.json') && !f.startsWith('_template')
  );

  if (files.length === 0) {
    console.log('No project JSON files to migrate.');
    return;
  }

  console.log(`Found ${files.length} project file(s) in config/projects/.`);
  let inserted = 0;
  let skipped = 0;

  for (const filename of files) {
    let cfg: ProjectConfig;
    try {
      cfg = JSON.parse(readFileSync(join(dir, filename), 'utf8')) as ProjectConfig;
    } catch (e) {
      console.warn(`  ! ${filename}: invalid JSON, skipped (${(e as Error).message})`);
      skipped++;
      continue;
    }

    if (!cfg.id || !cfg.name) {
      console.warn(`  ! ${filename}: missing id/name, skipped`);
      skipped++;
      continue;
    }

    const encrypted = encryptSecret(cfg.wordpress?.appPassword || '');

    const result = await pool.query(
      `INSERT INTO projects (
        id, name, enabled, owner_email,
        wp_base_url, wp_username, wp_app_password_encrypted,
        sheet_id, sheet_tab_name, sheet_columns, sheet_header_row,
        sheet_trigger_value, sheet_completed_value,
        page_type_routing, publish_status
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13,
        $14, $15
      )
      ON CONFLICT (id) DO NOTHING`,
      [
        cfg.id,
        cfg.name,
        cfg.enabled !== false,
        cfg.ownerEmail || null,
        cfg.wordpress?.baseUrl || '',
        cfg.wordpress?.username || '',
        encrypted,
        cfg.sheet?.sheetId || '',
        cfg.sheet?.tabName || '',
        JSON.stringify(cfg.sheet?.columns || {}),
        cfg.sheet?.headerRow ?? 1,
        cfg.sheet?.triggerValue || 'In-Progress',
        cfg.sheet?.completedValue || 'Content Live',
        JSON.stringify(cfg.pageTypeRouting || {}),
        cfg.publishStatus || 'draft',
      ]
    );

    if (result.rowCount === 1) {
      console.log(`  ✓ ${cfg.id}`);
      inserted++;
    } else {
      console.log(`  · ${cfg.id} (already in DB, skipped)`);
      skipped++;
    }
  }

  console.log(`\nDone. Inserted: ${inserted}, Skipped: ${skipped}`);
}

main()
  .catch((e) => {
    console.error('Import failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
