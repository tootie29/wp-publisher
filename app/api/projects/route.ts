// app/api/projects/route.ts
import { NextResponse } from 'next/server';
import { listProjects, publicProject, saveProject } from '@/lib/projects';
import type { ProjectConfig } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ projects: listProjects().map(publicProject) });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ProjectConfig;
    const err = validate(body);
    if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });
    const saved = saveProject(body);
    return NextResponse.json({ ok: true, project: publicProject(saved) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

function validate(p: Partial<ProjectConfig>): string | null {
  if (!p.name) return 'Project name is required';
  if (!p.wordpress?.baseUrl) return 'WordPress URL is required';
  if (!p.wordpress?.username) return 'WordPress username is required';
  if (!p.wordpress?.appPassword) return 'WordPress app password is required';
  if (!p.sheet?.sheetId) return 'Google Sheet ID is required';
  if (!p.sheet?.tabName) return 'Sheet tab name is required';
  if (!p.sheet?.columns?.status) return 'Status column letter is required';
  if (!p.sheet?.columns?.pageType) return 'Page Type column letter is required';
  if (!p.sheet?.columns?.primaryKeyword) return 'Primary Keyword column letter is required';
  if (!p.sheet?.columns?.contentLink) return 'Content Link column letter is required';
  try {
    new URL(p.wordpress.baseUrl);
  } catch {
    return 'WordPress URL must be a valid URL like https://example.com';
  }
  return null;
}
