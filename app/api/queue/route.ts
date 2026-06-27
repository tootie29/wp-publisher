// app/api/queue/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { fetchQueue } from '@/lib/sheets';
import { getProcessed } from '@/lib/state';
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
    const processed = await getProcessed(project.id);
    const procByRow = new Map(processed.map((r) => [r.rowIndex, r]));

    // queue = In-progress rows not yet published (the worker will process these).
    const queue = queueRows.filter((r) => !procByRow.has(r.rowIndex));

    // alreadyPublished = rows set to In-progress that are already in the ledger.
    // These are skipped by the worker; surface them so they can be re-queued.
    const alreadyPublished = queueRows
      .filter((r) => procByRow.has(r.rowIndex))
      .map((r) => {
        const rec = procByRow.get(r.rowIndex)!;
        return {
          rowIndex: r.rowIndex,
          primaryKeyword: r.primaryKeyword,
          pageType: r.pageType,
          contentLink: r.contentLink,
          wpLink: rec.wpLink,
          route: rec.route,
        };
      });

    return NextResponse.json({ queue, alreadyPublished });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
