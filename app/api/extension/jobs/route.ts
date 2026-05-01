// app/api/extension/jobs/route.ts
// Long-poll-ish endpoint the browser extension hits to pick up the next
// fetch job. Returns 204 if nothing pending.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { takeNextJob } from '@/lib/fetch-queue';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const job = takeNextJob();
  if (!job) return new NextResponse(null, { status: 204 });
  return NextResponse.json(job);
}
