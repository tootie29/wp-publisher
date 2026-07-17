// app/api/projects/[id]/published/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { clearProcessed, recentProcessed, runSummary } from '@/lib/state';
import { ownsProject } from '@/lib/users';
import { listTerms } from '@/lib/wordpress';

export const dynamic = 'force-dynamic';

function authHeader(username: string, appPassword: string): string {
  return 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');
}

interface WpDetailItem {
  id: number;
  status: 'draft' | 'publish' | 'pending' | 'private' | 'future' | 'trash';
  yoast_head_json?: { title?: string; description?: string };
  meta?: Record<string, unknown>;
  categories?: number[];
  tags?: number[];
}

// What the Drafts tab needs about each item beyond the local ledger: its live
// WordPress status, plus the SEO/taxonomy fields so they're editable before the
// item is published.
interface WpDetail {
  status: string;
  metaTitle: string;
  metaDescription: string;
  keyword: string;
  categories: string[];
  tags: string[];
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;/g, '’')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// Look up live details for a list of post/page IDs. Splits into one /posts and
// one /pages call (each filtered with ?include=...) — the SEO and taxonomy
// fields ride along on the same request the status check already made, so the
// Drafts tab costs no extra round-trips.
// If the request fails the entry is just omitted; the caller falls back to
// "unknown" and the item still renders.
async function fetchWpDetails(
  baseUrl: string,
  username: string,
  password: string,
  postIds: number[],
  pageIds: number[],
  termNames: { categories: Map<number, string>; tags: Map<number, string> }
): Promise<Map<number, WpDetail>> {
  const out = new Map<number, WpDetail>();
  const auth = authHeader(username, password);

  async function batch(type: 'posts' | 'pages', ids: number[]) {
    if (!ids.length) return;
    const url =
      `${baseUrl}/wp-json/wp/v2/${type}` +
      `?include=${ids.join(',')}&per_page=${Math.min(ids.length, 100)}` +
      `&status=any&context=edit&_fields=id,status,yoast_head_json,meta,categories,tags`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: auth },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const list = (await res.json()) as WpDetailItem[];
      for (const it of list) {
        const meta = it.meta || {};
        const raw = (k: string) => (typeof meta[k] === 'string' ? (meta[k] as string) : '');
        out.set(it.id, {
          status: it.status,
          metaTitle: stripHtml(raw('_yoast_wpseo_title') || it.yoast_head_json?.title || ''),
          metaDescription: stripHtml(
            raw('_yoast_wpseo_metadesc') || it.yoast_head_json?.description || ''
          ),
          keyword: raw('_yoast_wpseo_focuskw'),
          categories: (it.categories || [])
            .map((id) => termNames.categories.get(id) || '')
            .filter(Boolean),
          tags: (it.tags || []).map((id) => termNames.tags.get(id) || '').filter(Boolean),
        });
      }
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

  const records = await recentProcessed(project.id, limit);
  const summary = await runSummary(project.id);

  // Live-check WP status for every item so the dashboard can hide rows that
  // were published (or trashed) in WordPress out-of-band.
  const postIds = records.filter((r) => r.route === 'post').map((r) => r.wpId);
  const pageIds = records.filter((r) => r.route === 'page').map((r) => r.wpId);
  const base = project.wordpress.baseUrl.replace(/\/+$/, '');

  // Term id → name, so each item's categories/tags come back as names the UI can
  // render and edit. Best-effort: on failure terms render empty rather than
  // failing the whole tab.
  const [categoryTerms, tagTerms] = await Promise.all([
    listTerms(project, 'categories').catch(() => []),
    listTerms(project, 'tags').catch(() => []),
  ]);
  const detailMap = await fetchWpDetails(
    base,
    project.wordpress.username,
    project.wordpress.appPassword,
    postIds,
    pageIds,
    {
      categories: new Map(categoryTerms.map((t) => [t.id, t.name])),
      tags: new Map(tagTerms.map((t) => [t.id, t.name])),
    }
  );

  const published = records.map((r) => {
    const d = detailMap.get(r.wpId);
    return {
      ...r,
      currentStatus: d?.status || 'unknown',
      metaTitle: d?.metaTitle ?? '',
      metaDescription: d?.metaDescription ?? '',
      keyword: d?.keyword || r.primaryKeyword || '',
      categories: d?.categories ?? [],
      tags: d?.tags ?? [],
    };
  });

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
  const cleared = await clearProcessed(project.id);
  return NextResponse.json({ ok: true, cleared });
}
