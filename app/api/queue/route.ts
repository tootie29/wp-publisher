// app/api/queue/route.ts
import { NextResponse } from 'next/server';
import { getProject } from '@/lib/projects';
import { fetchQueue } from '@/lib/sheets';
import { hasProcessed } from '@/lib/state';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get('projectId');
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  try {
    const queue = (await fetchQueue(project)).filter(
      (r) => !hasProcessed(project.id, r.rowIndex)
    );
    return NextResponse.json({ queue });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
