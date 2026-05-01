// app/api/projects/[id]/published/route.ts
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getProject } from '@/lib/projects';
import { recentProcessed, runSummary } from '@/lib/state';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const project = getProject(params.id);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const published = recentProcessed(project.id, limit);
  const summary = runSummary(project.id);
  return NextResponse.json({ published, summary });
}

// Clear processed history (will cause all completed rows to be re-checked)
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const project = getProject(params.id);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const file = path.join(process.cwd(), 'data', `${project.id}.processed.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return NextResponse.json({ ok: true });
}
