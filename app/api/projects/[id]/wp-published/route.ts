// app/api/projects/[id]/wp-published/route.ts
// Returns posts and pages currently with status=publish on the project's
// WordPress site. Used by the dashboard's "Published" tab.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { getProcessed } from '@/lib/state';
import { ownsProject } from '@/lib/users';

export const dynamic = 'force-dynamic';

interface WpItem {
  id: number;
  date: string;
  modified: string;
  link: string;
  title: { rendered: string };
  status: string;
  type: 'post' | 'page';
  yoast_head_json?: {
    title?: string;
    description?: string;
    og_title?: string;
    og_description?: string;
  };
  meta?: Record<string, unknown>;
}

interface PublishedRow {
  id: number;
  type: 'post' | 'page';
  title: string;
  metaTitle: string;
  metaDescription: string;
  keyword: string;
  link: string;
  editLink: string;
  date: string;
  modified: string;
}

function authHeader(username: string, appPassword: string): string {
  const token = Buffer.from(`${username}:${appPassword}`).toString('base64');
  return `Basic ${token}`;
}

async function fetchType(
  base: string,
  type: 'posts' | 'pages',
  username: string,
  appPassword: string,
  perPage: number
): Promise<WpItem[]> {
  const url = `${base}/wp-json/wp/v2/${type}?status=publish&per_page=${perPage}&orderby=modified&order=desc&_fields=id,date,modified,link,title,status,type,yoast_head_json,meta`;
  const res = await fetch(url, {
    headers: { Authorization: authHeader(username, appPassword) },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${type} fetch failed (${res.status})`);
  return (await res.json()) as WpItem[];
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const project = await getProject(params.id);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!ownsProject(project.ownerEmail, session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 100);

  const base = project.wordpress.baseUrl.replace(/\/+$/, '');
  const username = project.wordpress.username;
  const password = project.wordpress.appPassword;

  try {
    const [posts, pages] = await Promise.all([
      fetchType(base, 'posts', username, password, limit),
      fetchType(base, 'pages', username, password, limit),
    ]);

    // Build a wpId → keyword map from our local published history so we can fill
    // the keyword column for items this app created. Items the WP site already
    // had (or that someone else published) won't have a keyword unless Yoast's
    // focus keyphrase meta is exposed via REST on the site.
    const localKeywordById = new Map<number, string>();
    for (const r of getProcessed(params.id)) {
      if (r.primaryKeyword) localKeywordById.set(r.wpId, r.primaryKeyword);
    }

    const merged: PublishedRow[] = [...posts, ...pages]
      .map((it) => {
        const yoast = it.yoast_head_json || {};
        const meta = (it.meta as Record<string, unknown> | undefined) || {};
        const rawFocus = typeof meta['_yoast_wpseo_focuskw'] === 'string' ? (meta['_yoast_wpseo_focuskw'] as string) : '';
        const rawTitle = typeof meta['_yoast_wpseo_title'] === 'string' ? (meta['_yoast_wpseo_title'] as string) : '';
        const rawDesc = typeof meta['_yoast_wpseo_metadesc'] === 'string' ? (meta['_yoast_wpseo_metadesc'] as string) : '';

        // Prefer raw Yoast meta (only available when the wp-publisher plugin
        // is installed). Fall back to the rendered yoast_head_json values.
        const metaTitle = stripHtml(rawTitle || yoast.title || '');
        const metaDescription = stripHtml(rawDesc || yoast.description || '');
        const keyword = rawFocus || localKeywordById.get(it.id) || '';

        return {
          id: it.id,
          type: it.type,
          title: stripHtml(it.title?.rendered || ''),
          metaTitle,
          metaDescription,
          keyword,
          link: it.link,
          editLink: `${base}/wp-admin/post.php?post=${it.id}&action=edit`,
          date: it.date,
          modified: it.modified,
        };
      })
      .sort((a, b) => +new Date(b.modified) - +new Date(a.modified))
      .slice(0, limit);

    return NextResponse.json({ items: merged });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
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
