// app/api/queue/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { fetchQueue } from '@/lib/sheets';
import { hasProcessed } from '@/lib/state';
import { ownsProject } from '@/lib/users';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const url = new URL(req.url);
  const projectId = url.searchParams.get('projectId');
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (!ownsProject(project.ownerEmail, session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const queueRows = await fetchQueue(project);
    const checks = await Promise.all(
      queueRows.map((r) => hasProcessed(project.id, r.rowIndex))
    );
    const queue = queueRows.filter((_, i) => !checks[i]);
    return NextResponse.json({ queue });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
