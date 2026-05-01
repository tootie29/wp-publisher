// app/api/extension/jobs/[id]/route.ts
// The extension POSTs the fetched HTML (or an error message) back here.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { completeJob } from '@/lib/fetch-queue';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    html?: string;
    title?: string;
    error?: string;
  };
  const ok = completeJob(params.id, body.html, body.error, body.title);
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'Unknown or expired job' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
