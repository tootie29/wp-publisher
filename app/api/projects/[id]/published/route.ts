// app/api/projects/[id]/published/route.ts
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { auth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { recentProcessed, runSummary } from '@/lib/state';
import { ownsProject } from '@/lib/users';

export const dynamic = 'force-dynamic';

function authHeader(username: string, appPassword: string): string {
  return 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');
}

interface WpStatusItem {
  id: number;
  status: 'draft' | 'publish' | 'pending' | 'private' | 'future' | 'trash';
}

// Look up the current WordPress status for a list of post/page IDs.
// Splits into one /posts and one /pages call (each filtered with ?include=...).
// If the request fails the entry is just omitted; the caller falls back to
// "unknown" and the item still renders.
async function fetchCurrentStatuses(
  baseUrl: string,
  username: string,
  password: string,
  postIds: number[],
  pageIds: number[]
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const auth = authHeader(username, password);

  async function batch(type: 'posts' | 'pages', ids: number[]) {
    if (!ids.length) return;
    const url =
      `${baseUrl}/wp-json/wp/v2/${type}` +
      `?include=${ids.join(',')}&per_page=${Math.min(ids.length, 100)}` +
      `&status=any&_fields=id,status`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: auth },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const list = (await res.json()) as WpStatusItem[];
      for (const it of list) out.set(it.id, it.status);
    } catch {
      /* ignore — those items just won't have a currentStatus */
    }
  }

  await Promise.all([batch('posts', postIds), batch('pages', pageIds)]);
  return out;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const project = await getProject(params.id);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!ownsProject(project.ownerEmail, session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);

  const records = recentProcessed(project.id, limit);
  const summary = runSummary(project.id);

  // Live-check WP status for every item so the dashboard can hide rows that
  // were published (or trashed) in WordPress out-of-band.
  const postIds = records.filter((r) => r.route === 'post').map((r) => r.wpId);
  const pageIds = records.filter((r) => r.route === 'page').map((r) => r.wpId);
  const base = project.wordpress.baseUrl.replace(/\/+$/, '');
  const statusMap = await fetchCurrentStatuses(
    base,
    project.wordpress.username,
    project.wordpress.appPassword,
    postIds,
    pageIds
  );

  const published = records.map((r) => ({
    ...r,
    currentStatus: statusMap.get(r.wpId) || 'unknown',
  }));

  return NextResponse.json({ published, summary });
}

// Clear processed history (will cause all completed rows to be re-checked)
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const project = await getProject(params.id);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!ownsProject(project.ownerEmail, session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const file = path.join(process.cwd(), 'data', `${project.id}.processed.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return NextResponse.json({ ok: true });
}
