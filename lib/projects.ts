// lib/projects.ts
import fs from 'node:fs';
import path from 'node:path';
import type { ProjectConfig } from './types';

const PROJECTS_DIR = path.join(process.cwd(), 'config', 'projects');

function ensureDir() {
  if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

export function listProjects(): ProjectConfig[] {
  ensureDir();
  const files = fs
    .readdirSync(PROJECTS_DIR)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_template'));
  const projects: ProjectConfig[] = [];
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf8');
      const cfg = JSON.parse(raw) as ProjectConfig;
      projects.push(cfg);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`Failed to parse project config ${f}:`, e);
    }
  }
  return projects;
}

export function getProject(id: string): ProjectConfig | null {
  return listProjects().find((p) => p.id === id) ?? null;
}

// Safe public view (no credentials)
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

// Return the projects that should be visible to a given user. Projects with
// no ownerEmail are treated as legacy/shared (visible to all) until claimed.
export function listProjectsForUser(email: string | null | undefined): ProjectConfig[] {
  const me = (email || '').toLowerCase();
  return listProjects().filter(
    (p) => !p.ownerEmail || p.ownerEmail.toLowerCase() === me
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function fileFor(id: string): string {
  ensureDir();
  return path.join(PROJECTS_DIR, `${id}.json`);
}

export function saveProject(cfg: ProjectConfig, originalId?: string): ProjectConfig {
  ensureDir();
  if (!cfg.id) cfg.id = slugify(cfg.name);
  if (!cfg.id) throw new Error('Project id/name required');

  if (originalId && originalId !== cfg.id) {
    const old = fileFor(originalId);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  } else if (!originalId) {
    const base = cfg.id;
    let n = 1;
    while (fs.existsSync(fileFor(cfg.id))) {
      n += 1;
      cfg.id = `${base}-${n}`;
    }
  }

  fs.writeFileSync(fileFor(cfg.id), JSON.stringify(cfg, null, 2));
  return cfg;
}

export function deleteProject(id: string): boolean {
  const f = fileFor(id);
  if (fs.existsSync(f)) {
    fs.unlinkSync(f);
    return true;
  }
  return false;
}
