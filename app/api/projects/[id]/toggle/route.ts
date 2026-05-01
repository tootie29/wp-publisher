// app/api/projects/[id]/toggle/route.ts
import { NextResponse } from 'next/server';
import { getProject, publicProject, saveProject } from '@/lib/projects';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const project = getProject(params.id);
  if (!project) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const next = typeof body.enabled === 'boolean' ? body.enabled : !project.enabled;

  const updated = { ...project, enabled: next };
  const saved = saveProject(updated, project.id);
  return NextResponse.json({ ok: true, project: publicProject(saved) });
}
