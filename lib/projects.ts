// lib/projects.ts
// Postgres-backed project store. Replaces the per-file JSON store under
// config/projects/. WP application passwords are stored encrypted at rest
// (AES-256-GCM via lib/secret-crypto.ts).
import { pool } from './db';
import { encryptSecret, decryptSecret } from './secret-crypto';
import type { PageTypeRoute, ProjectConfig } from './types';

interface ProjectRow {
  id: string;
  name: string;
  enabled: boolean;
  owner_email: string | null;
  wp_base_url: string;
  wp_username: string;
  wp_app_password_encrypted: string;
  sheet_id: string;
  sheet_tab_name: string;
  sheet_columns: ProjectConfig['sheet']['columns'];
  sheet_header_row: number;
  sheet_trigger_value: string;
  sheet_completed_value: string;
  page_type_routing: Record<string, PageTypeRoute>;
  publish_status: ProjectConfig['publishStatus'];
}

function rowToProject(r: ProjectRow): ProjectConfig {
  return {
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    ownerEmail: r.owner_email ?? undefined,
    wordpress: {
      baseUrl: r.wp_base_url,
      username: r.wp_username,
      appPassword: decryptSecret(r.wp_app_password_encrypted),
    },
    sheet: {
      sheetId: r.sheet_id,
      tabName: r.sheet_tab_name,
      columns: r.sheet_columns,
      headerRow: r.sheet_header_row,
      triggerValue: r.sheet_trigger_value,
      completedValue: r.sheet_completed_value,
    },
    pageTypeRouting: r.page_type_routing,
    publishStatus: r.publish_status,
  };
}

export async function listProjects(): Promise<ProjectConfig[]> {
  const { rows } = await pool.query<ProjectRow>(
    'SELECT * FROM projects ORDER BY name'
  );
  return rows.map(rowToProject);
}

export async function getProject(id: string): Promise<ProjectConfig | null> {
  const { rows } = await pool.query<ProjectRow>(
    'SELECT * FROM projects WHERE id = $1',
    [id]
  );
  if (!rows.length) return null;
  return rowToProject(rows[0]);
}

// All authenticated team members see every project — projects are shared
// across the team to avoid duplicate setup. The `email` parameter is kept
// for API compatibility / future per-user filtering but is currently ignored.
export async function listProjectsForUser(
  _email: string | null | undefined
): Promise<ProjectConfig[]> {
  return listProjects();
}

// Strips secrets — safe for serialization to the dashboard UI.
export function publicProject(p: ProjectConfig) {
  return {
    id: p.id,
    name: p.name,
    enabled: p.enabled,
    wordpress: { baseUrl: p.wordpress.baseUrl, username: p.wordpress.username },
    sheet: {
      sheetId: p.sheet.sheetId,
      tabName: p.sheet.tabName,
      columns: p.sheet.columns,
      headerRow: p.sheet.headerRow,
      triggerValue: p.sheet.triggerValue,
      completedValue: p.sheet.completedValue,
    },
    pageTypeRouting: p.pageTypeRouting,
    publishStatus: p.publishStatus,
    ownerEmail: p.ownerEmail || null,
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function idTaken(id: string): Promise<boolean> {
  const { rowCount } = await pool.query('SELECT 1 FROM projects WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

export async function saveProject(
  cfg: ProjectConfig,
  originalId?: string
): Promise<ProjectConfig> {
  if (!cfg.id) cfg.id = slugify(cfg.name);
  if (!cfg.id) throw new Error('Project id/name required');

  // For new projects, bump the slug suffix until we find an unused id.
  if (!originalId) {
    const base = cfg.id;
    let n = 1;
    while (await idTaken(cfg.id)) {
      n += 1;
      cfg.id = `${base}-${n}`;
    }
  }

  // Resolve the encrypted password to write. An empty string on edit means
  // "leave the existing password untouched" — the form only sends a value
  // when the user is rotating it.
  let encryptedPw: string;
  if (cfg.wordpress.appPassword) {
    encryptedPw = encryptSecret(cfg.wordpress.appPassword);
  } else if (originalId) {
    const existing = await pool.query<{ wp_app_password_encrypted: string }>(
      'SELECT wp_app_password_encrypted FROM projects WHERE id = $1',
      [originalId]
    );
    if (!existing.rowCount) {
      throw new Error(`Project ${originalId} not found`);
    }
    encryptedPw = existing.rows[0].wp_app_password_encrypted;
  } else {
    throw new Error('WordPress app password is required for new projects');
  }

  const params = [
    cfg.id,
    cfg.name,
    cfg.enabled,
    cfg.ownerEmail ?? null,
    cfg.wordpress.baseUrl,
    cfg.wordpress.username,
    encryptedPw,
    cfg.sheet.sheetId,
    cfg.sheet.tabName,
    JSON.stringify(cfg.sheet.columns ?? {}),
    cfg.sheet.headerRow ?? 1,
    cfg.sheet.triggerValue,
    cfg.sheet.completedValue,
    JSON.stringify(cfg.pageTypeRouting ?? {}),
    cfg.publishStatus,
  ];

  await pool.query(
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
    ON CONFLICT (id) DO UPDATE SET
      name                      = EXCLUDED.name,
      enabled                   = EXCLUDED.enabled,
      owner_email               = EXCLUDED.owner_email,
      wp_base_url               = EXCLUDED.wp_base_url,
      wp_username               = EXCLUDED.wp_username,
      wp_app_password_encrypted = EXCLUDED.wp_app_password_encrypted,
      sheet_id                  = EXCLUDED.sheet_id,
      sheet_tab_name            = EXCLUDED.sheet_tab_name,
      sheet_columns             = EXCLUDED.sheet_columns,
      sheet_header_row          = EXCLUDED.sheet_header_row,
      sheet_trigger_value       = EXCLUDED.sheet_trigger_value,
      sheet_completed_value     = EXCLUDED.sheet_completed_value,
      page_type_routing         = EXCLUDED.page_type_routing,
      publish_status            = EXCLUDED.publish_status,
      updated_at                = NOW()`,
    params
  );

  // Rename: drop the row at the old id.
  if (originalId && originalId !== cfg.id) {
    await pool.query('DELETE FROM projects WHERE id = $1', [originalId]);
  }

  return cfg;
}

export async function deleteProject(id: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM projects WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}
