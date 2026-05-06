// app/api/extension/jobs/[id]/route.ts
// The extension POSTs the fetched HTML (or an error message) back here.
// The result is only accepted from the same user that picked up the job.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { completeJob } from '@/lib/fetch-queue';
import { userKey } from '@/lib/users';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    html?: string;
    title?: string;
    error?: string;
  };
  const ok = await completeJob(
    params.id,
    userKey(session.user.email),
    body.html,
    body.error,
    body.title
  );
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: 'Unknown or expired job (or wrong owner)' },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}
