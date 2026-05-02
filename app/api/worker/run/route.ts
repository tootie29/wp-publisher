// app/api/worker/run/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { runAll, runProject } from '@/lib/worker';
import { updateLiveState } from '@/lib/live-state';
import { ownsProject } from '@/lib/users';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
    }
    const runnerEmail = session.user.email;

    const body = await req.json().catch(() => ({}));
    const { projectId } = body as { projectId?: string };

    // Reset any previous stop request so this run isn't cancelled out of the gate.
    updateLiveState({ cancelRequested: false });

    if (projectId) {
      const project = getProject(projectId);
      if (!project) return NextResponse.json({ ok: false, error: 'Project not found' }, { status: 404 });
      if (!ownsProject(project.ownerEmail, runnerEmail)) {
        return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
      }
      await runProject(project, runnerEmail);
      updateLiveState({
        running: false, projectId: null, rowIndex: null,
        phase: 'idle', message: 'Idle', cancelRequested: false,
      });
    } else {
      await runAll();
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
