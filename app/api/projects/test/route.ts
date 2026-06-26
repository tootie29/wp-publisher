// app/api/projects/test/route.ts
import { NextResponse } from 'next/server';
import { probe } from '@/lib/sheets';
import { probeWp } from '@/lib/wordpress';
import { getProject } from '@/lib/projects';
import type { ProjectConfig } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Given a project config body (not yet saved), test sheet + WP connectivity.
// When editing, the form blanks out the saved app password (the edit endpoint
// never sends it back). If the test comes in without a password but with an
// existing project id, fall back to the stored password so "Test now" reflects
// the real connection instead of failing on an empty credential.
export async function POST(req: Request) {
  try {
    const project = (await req.json()) as ProjectConfig;
    if (!project.wordpress?.appPassword && project.id) {
      const stored = await getProject(project.id);
      if (stored?.wordpress?.appPassword) {
        project.wordpress = { ...project.wordpress, appPassword: stored.wordpress.appPassword };
      }
    }
    const [sheet, wp] = await Promise.all([probe(project), probeWp(project)]);
    return NextResponse.json({ sheet, wp });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
