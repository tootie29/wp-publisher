// app/api/worker/run/route.ts
// Triggers a publisher run.
//
// - POST: user-triggered run from the dashboard. Requires an authenticated
//   session. With { projectId } it runs that project under the signed-in user
//   as runner; without, it runs all projects the user owns.
// - GET:  used by Vercel Cron. Requires `Authorization: Bearer ${CRON_SECRET}`
//   and runs every project under its own ownerEmail (no UI session involved).
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { runAll, runProject } from '@/lib/worker';
import { updateLiveState } from '@/lib/live-state';
import { ownsProject } from '@/lib/users';

export const dynamic = 'force-dynamic';
// Worker runs can take longer than the 10s hobby default. Pro plans cap at 300s.
export const maxDuration = 60;

function isCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization') || '';
  return auth === `Bearer ${secret}`;
}

function endLiveState() {
  updateLiveState({
    running: false, projectId: null, rowIndex: null,
    phase: 'idle', message: 'Idle', cancelRequested: false,
  });
}

// Cron entrypoint — bearer-protected, no UI session needed.
export async function GET(req: Request) {
  if (!isCronRequest(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    updateLiveState({ cancelRequested: false });
    await runAll();
    return NextResponse.json({ ok: true, mode: 'cron' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
    }
    const runnerEmail = session.user.email;

    const body = await req.json().catch(() => ({}));
    const { projectId } = body as { projectId?: string };

    updateLiveState({ cancelRequested: false });

    if (projectId) {
      const project = await getProject(projectId);
      if (!project) return NextResponse.json({ ok: false, error: 'Project not found' }, { status: 404 });
      if (!ownsProject(project.ownerEmail, runnerEmail)) {
        return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
      }
      await runProject(project, runnerEmail);
      endLiveState();
    } else {
      await runAll();
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
