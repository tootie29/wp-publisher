// app/api/projects/[id]/health/route.ts
import { NextResponse } from 'next/server';
import { getProject } from '@/lib/projects';
import { probe } from '@/lib/sheets';
import { probeWp } from '@/lib/wordpress';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const project = getProject(params.id);
  if (!project) {
    return NextResponse.json(
      {
        sheet: { ok: false, error: 'Project not found' },
        wp: { ok: false, error: 'Project not found' },
      },
      { status: 404 }
    );
  }

  const [sheetR, wpR] = await Promise.allSettled([probe(project), probeWp(project)]);

  const sheet = sheetR.status === 'fulfilled'
    ? sheetR.value
    : { ok: false, error: (sheetR.reason as Error)?.message || 'probe failed' };

  const wp = wpR.status === 'fulfilled'
    ? wpR.value
    : { ok: false, error: (wpR.reason as Error)?.message || 'probe failed' };

  return NextResponse.json({ sheet, wp });
}
