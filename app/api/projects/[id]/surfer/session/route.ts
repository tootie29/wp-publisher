// app/api/projects/[id]/surfer/session/route.ts
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import { getProject } from '@/lib/projects';
import { checkSurferSession, hasProfile, profileDir } from '@/lib/extract';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const project = await getProject(params.id);
  if (!project) {
    return NextResponse.json({ loggedIn: false, detail: 'Project not found' }, { status: 404 });
  }
  if (!hasProfile(project.id)) {
    return NextResponse.json({ loggedIn: false, detail: 'No profile yet — log in first.' });
  }
  const result = await checkSurferSession(project.id);
  return NextResponse.json(result);
}

// Clear the saved browser profile (logout)
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const project = await getProject(params.id);
  if (!project) return NextResponse.json({ ok: false, error: 'Project not found' }, { status: 404 });
  const dir = profileDir(project.id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  return NextResponse.json({ ok: true });
}
