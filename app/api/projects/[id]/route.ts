// app/api/projects/[id]/route.ts
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { auth } from '@/lib/auth';
import { deleteProject, getProject, publicProject, saveProject } from '@/lib/projects';
import { profileDir } from '@/lib/extract';
import { ownsProject } from '@/lib/users';
import type { ProjectConfig } from '@/lib/types';

async function gateProject(id: string) {
  const session = await auth();
  if (!session?.user?.email) {
    return { resp: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }
  const project = getProject(id);
  if (!project) {
    return { resp: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  if (!ownsProject(project.ownerEmail, session.user.email)) {
    return { resp: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { project, email: session.user.email };
}

export const dynamic = 'force-dynamic';

// Returns FULL project (including credentials) for editing.
// Only exposed via localhost — acceptable for a local-only dashboard.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const gate = await gateProject(params.id);
  if (gate.resp) return gate.resp;
  return NextResponse.json({ project: gate.project });
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const gate = await gateProject(params.id);
    if (gate.resp) return gate.resp;

    const body = (await req.json()) as ProjectConfig;
    const err = validate(body);
    if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });

    // Preserve ownership. Don't let edits silently re-stamp the owner.
    body.ownerEmail = gate.project.ownerEmail || gate.email;

    const saved = saveProject(body, params.id);
    return NextResponse.json({ ok: true, project: publicProject(saved) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  const gate = await gateProject(id);
  if (gate.resp) return gate.resp;

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
