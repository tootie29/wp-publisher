// app/api/projects/test/route.ts
import { NextResponse } from 'next/server';
import { probe } from '@/lib/sheets';
import { probeWp } from '@/lib/wordpress';
import type { ProjectConfig } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Given a project config body (not yet saved), test sheet + WP connectivity.
export async function POST(req: Request) {
  try {
    const project = (await req.json()) as ProjectConfig;
    const [sheet, wp] = await Promise.all([probe(project), probeWp(project)]);
    return NextResponse.json({ sheet, wp });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
