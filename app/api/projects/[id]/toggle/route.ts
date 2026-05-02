// app/api/projects/[id]/toggle/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getProject, publicProject, saveProject } from '@/lib/projects';
import { ownsProject } from '@/lib/users';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
  }
  const project = getProject(params.id);
  if (!project) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  if (!ownsProject(project.ownerEmail, session.user.email)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const next = typeof body.enabled === 'boolean' ? body.enabled : !project.enabled;

  const updated = { ...project, enabled: next };
  const saved = saveProject(updated, project.id);
  return NextResponse.json({ ok: true, project: publicProject(saved) });
}
