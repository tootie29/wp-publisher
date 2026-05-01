// app/api/projects/[id]/surfer/login/route.ts
import { NextResponse } from 'next/server';
import { getProject } from '@/lib/projects';
import { openSurferLogin } from '@/lib/extract';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const project = getProject(params.id);
  if (!project) return NextResponse.json({ ok: false, error: 'Project not found' }, { status: 404 });

  const result = await openSurferLogin(project.id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    message:
      'A Chromium window opened. Log in to Surfer, then CLOSE the window. Your session will persist for this project.',
  });
}
