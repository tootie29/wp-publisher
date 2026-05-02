// app/api/extension/jobs/route.ts
// Returns the next pending fetch job that matches the current user. Each
// signed-in user only gets jobs queued by them, so multi-user scenarios
// don't cross-contaminate Surfer/Frase sessions.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { takeNextJobForOwner } from '@/lib/fetch-queue';
import { userKey } from '@/lib/users';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const job = takeNextJobForOwner(userKey(session.user.email));
  if (!job) return new NextResponse(null, { status: 204 });
  return NextResponse.json(job);
}
