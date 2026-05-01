// app/api/projects/[id]/route.ts
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { deleteProject, getProject, publicProject, saveProject } from '@/lib/projects';
import { profileDir } from '@/lib/extract';
import type { ProjectConfig } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Returns FULL project (including credentials) for editing.
// Only exposed via localhost — acceptable for a local-only dashboard.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const p = getProject(params.id);
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ project: p });
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json()) as ProjectConfig;
    const err = validate(body);
    if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });
    const saved = saveProject(body, params.id);
    return NextResponse.json({ ok: true, project: publicProject(saved) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  if (!getProject(id)) {
    return NextResponse.json({ ok: false, error: 'Project not found' }, { status: 404 });
  }

  // Remove project config
  const ok = deleteProject(id);

  // Best-effort cleanup of project-scoped files. We log but don't fail the
  // delete if any of these are already gone.
  const cleaned: string[] = [];
  const dataDir = process.env.DATA_DIR
    ? path.isAbsolute(process.env.DATA_DIR)
      ? process.env.DATA_DIR
      : path.join(process.cwd(), process.env.DATA_DIR)
    : path.join(process.cwd(), 'data');

  const targets = [
    path.join(dataDir, `${id}.processed.json`),    // local "Drafts" history
    path.join(dataDir, `${id}.log.jsonl`),         // logs
    path.join(dataDir, 'connector', id),            // saved Surfer/Frase cookies
    profileDir(id),                                 // legacy headful Playwright profile
  ];
  for (const p of targets) {
    try {
      if (!fs.existsSync(p)) continue;
      const stat = fs.statSync(p);
      if (stat.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
      else fs.unlinkSync(p);
      cleaned.push(path.basename(p));
    } catch {
      // ignore — best effort
    }
  }

  return NextResponse.json({ ok, cleaned });
}

function validate(p: Partial<ProjectConfig>): string | null {
  if (!p.name) return 'Project name is required';
  if (!p.wordpress?.baseUrl) return 'WordPress URL is required';
  if (!p.wordpress?.username) return 'WordPress username is required';
  if (!p.wordpress?.appPassword) return 'WordPress app password is required';
  if (!p.sheet?.sheetId) return 'Google Sheet ID is required';
  if (!p.sheet?.tabName) return 'Sheet tab name is required';
  return null;
}
