// app/api/worker/run/route.ts
import { NextResponse } from 'next/server';
import { getProject } from '@/lib/projects';
import { runAll, runProject } from '@/lib/worker';
import { updateLiveState } from '@/lib/live-state';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { projectId } = body as { projectId?: string };

    // Reset any previous stop request so this run isn't cancelled out of the gate.
    updateLiveState({ cancelRequested: false });

    if (projectId) {
      const project = getProject(projectId);
      if (!project) return NextResponse.json({ ok: false, error: 'Project not found' }, { status: 404 });
      await runProject(project);
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
