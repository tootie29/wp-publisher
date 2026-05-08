// lib/wordpress.ts
import type { PageTypeRoute, ProjectConfig } from './types';

export function resolveRoute(project: ProjectConfig, pageType: string): PageTypeRoute {
  const key = pageType.trim().toLowerCase();
  const routing = project.pageTypeRouting || {};
  if (routing[key]) return routing[key];
  // Default fallback
  return 'page';
}

function authHeader(project: ProjectConfig): string {
  const token = Buffer.from(
    `${project.wordpress.username}:${project.wordpress.appPassword}`
  ).toString('base64');
  return `Basic ${token}`;
}

function endpoint(project: ProjectConfig, route: PageTypeRoute): string {
  const base = project.wordpress.baseUrl.replace(/\/+$/, '');
  const path = route === 'post' ? 'posts' : 'pages';
  return `${base}/wp-json/wp/v2/${path}`;
}

export async function createDraft(
  project: ProjectConfig,
  route: PageTypeRoute,
  title: string,
  htmlContent: string
): Promise<{ id: number; link: string; editLink: string }> {
  const res = await fetch(endpoint(project, route), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(project),
    },
    body: JSON.stringify({
      title,
      content: htmlContent,
      status: project.publishStatus, // usually 'draft'
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WP create ${route} failed (${res.status}): ${text.slice(0, 500)}`);
  }
  const data = (await res.json()) as { id: number; link: string };
  const editLink = `${project.wordpress.baseUrl.replace(/\/+$/, '')}/wp-admin/post.php?post=${data.id}&action=edit`;
  return { id: data.id, link: data.link, editLink };
}

// Approximate WordPress's sanitize_title for slug-based lookups.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”]/g, '') // fancy quotes
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeTitle(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|’/g, "'")
    .replace(/&#8216;|‘/g, "'")
    .replace(/&#8220;|“/g, '"')
    .replace(/&#8221;|”/g, '"')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Resolve a WP post or page by its title. Tries slug match first (covers the
// common case where the slug was auto-generated from the title), then falls
// back to a search query and exact-title comparison. Pages are checked first
// because most "content refresh" workflows target landing pages.
export async function findPostByTitle(
  project: ProjectConfig,
  title: string
): Promise<{ id: number; type: PageTypeRoute; link: string; title: string } | null> {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const base = project.wordpress.baseUrl.replace(/\/+$/, '');
  const slug = slugify(trimmed);
  const target = normalizeTitle(trimmed);

  // 1. Slug match.
  if (slug) {
    for (const type of ['pages', 'posts'] as const) {
      const res = await fetch(
        `${base}/wp-json/wp/v2/${type}?slug=${encodeURIComponent(slug)}&_fields=id,link,title&per_page=5`,
        { headers: { Authorization: authHeader(project) }, cache: 'no-store' }
      );
      if (!res.ok) continue;
      const list = (await res.json()) as Array<{ id: number; link: string; title: { rendered: string } }>;
      if (list.length > 0) {
        return {
          id: list[0].id,
          type: type === 'pages' ? 'page' : 'post',
          link: list[0].link,
          title: list[0].title?.rendered || '',
        };
      }
    }
  }

  // 2. Search fallback. Compare normalized titles and pick the closest match.
  for (const type of ['pages', 'posts'] as const) {
    const res = await fetch(
      `${base}/wp-json/wp/v2/${type}?search=${encodeURIComponent(trimmed)}&_fields=id,link,title&per_page=20`,
      { headers: { Authorization: authHeader(project) }, cache: 'no-store' }
    );
    if (!res.ok) continue;
    const list = (await res.json()) as Array<{ id: number; link: string; title: { rendered: string } }>;

    const exact = list.find((it) => normalizeTitle(it.title?.rendered || '') === target);
    if (exact) {
      return {
        id: exact.id,
        type: type === 'pages' ? 'page' : 'post',
        link: exact.link,
        title: exact.title?.rendered || '',
      };
    }
    // No exact match. If only a single result came back, accept it. Multiple
    // ambiguous matches → bail out so we don't overwrite the wrong post.
    if (list.length === 1) {
      return {
        id: list[0].id,
        type: type === 'pages' ? 'page' : 'post',
        link: list[0].link,
        title: list[0].title?.rendered || '',
      };
    }
  }

  return null;
}

// Resolve a WP post or page by its public URL. Tries the slug-based lookup
// against both /posts and /pages and returns the first match.
export async function findPostByUrl(
  project: ProjectConfig,
  url: string
): Promise<{ id: number; type: PageTypeRoute; link: string } | null> {
  let slug: string;
  try {
    const u = new URL(url);
    const segments = u.pathname.split('/').filter(Boolean);
    slug = segments[segments.length - 1] || '';
  } catch {
    return null;
  }
  if (!slug) return null;

  const base = project.wordpress.baseUrl.replace(/\/+$/, '');
  for (const type of ['pages', 'posts'] as const) {
    const res = await fetch(
      `${base}/wp-json/wp/v2/${type}?slug=${encodeURIComponent(slug)}&_fields=id,link&per_page=5`,
      { headers: { Authorization: authHeader(project) }, cache: 'no-store' }
    );
    if (!res.ok) continue;
    const list = (await res.json()) as Array<{ id: number; link: string }>;
    if (list.length > 0) {
      return { id: list[0].id, type: type === 'pages' ? 'page' : 'post', link: list[0].link };
    }
  }
  return null;
}

export async function updatePost(
  project: ProjectConfig,
  route: PageTypeRoute,
  postId: number,
  htmlContent: string,
  title?: string
): Promise<{ id: number; link: string; editLink: string }> {
  const base = project.wordpress.baseUrl.replace(/\/+$/, '');
  const path = route === 'post' ? 'posts' : 'pages';
  const body: Record<string, unknown> = { content: htmlContent };
  if (title) body.title = title;
  const res = await fetch(`${base}/wp-json/wp/v2/${path}/${postId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(project),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WP update ${route} ${postId} failed (${res.status}): ${text.slice(0, 500)}`);
  }
  const data = (await res.json()) as { id: number; link: string };
  const editLink = `${base}/wp-admin/post.php?post=${data.id}&action=edit`;
  return { id: data.id, link: data.link, editLink };
}

// Update Yoast SEO meta (title, description, focus keyphrase) on an
// existing post or page. Requires the `wp-publisher-yoast-rest.php`
// mu-plugin on the WP site so the meta keys accept REST writes.
// Pass `undefined` to leave a field untouched; pass `''` to clear.
export async function updateYoastMeta(
  project: ProjectConfig,
  route: PageTypeRoute,
  postId: number,
  fields: { metaTitle?: string; metaDescription?: string; keyword?: string }
): Promise<{ metaTitle: string; metaDescription: string; keyword: string }> {
  const base = project.wordpress.baseUrl.replace(/\/+$/, '');
  const path = route === 'post' ? 'posts' : 'pages';
  const meta: Record<string, string> = {};
  if (fields.metaTitle !== undefined) meta['_yoast_wpseo_title'] = fields.metaTitle;
  if (fields.metaDescription !== undefined) meta['_yoast_wpseo_metadesc'] = fields.metaDescription;
  if (fields.keyword !== undefined) meta['_yoast_wpseo_focuskw'] = fields.keyword;
  if (Object.keys(meta).length === 0) {
    throw new Error('No fields to update');
  }
  const res = await fetch(`${base}/wp-json/wp/v2/${path}/${postId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(project),
    },
    body: JSON.stringify({ meta }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WP meta update failed (${res.status}): ${text.slice(0, 500)}`);
  }
  const data = (await res.json()) as { meta?: Record<string, string> };
  const m = data.meta || {};
  return {
    metaTitle: m['_yoast_wpseo_title'] || '',
    metaDescription: m['_yoast_wpseo_metadesc'] || '',
    keyword: m['_yoast_wpseo_focuskw'] || '',
  };
}

// Check whether a post/page with the given id still exists on the WordPress
// site. Returns false on 404 (or trash, which the REST API also returns 404
// for unless ?context=edit). Used to auto-clean stale local history when
// users delete posts in WP and want the publisher to re-create them.
export async function postExists(
  project: ProjectConfig,
  route: PageTypeRoute,
  postId: number
): Promise<boolean> {
  const base = project.wordpress.baseUrl.replace(/\/+$/, '');
  const path = route === 'post' ? 'posts' : 'pages';
  try {
    const res = await fetch(
      `${base}/wp-json/wp/v2/${path}/${postId}?context=edit&_fields=id,status`,
      {
        headers: { Authorization: authHeader(project) },
        cache: 'no-store',
      }
    );
    if (res.status === 404) return false;
    if (!res.ok) return true; // unknown error — assume exists, don't auto-delete
    const data = (await res.json()) as { id: number; status: string };
    // Treat trashed posts as "gone" so the publisher will recreate them.
    return data.status !== 'trash';
  } catch {
    // Network error — be safe, assume it exists
    return true;
  }
}

export async function probeWp(project: ProjectConfig): Promise<{
  ok: boolean;
  username?: string;
  error?: string;
}> {
  try {
    const res = await fetch(
      `${project.wordpress.baseUrl.replace(/\/+$/, '')}/wp-json/wp/v2/users/me`,
      { headers: { Authorization: authHeader(project) } }
    );
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as { slug?: string; name?: string };
    return { ok: true, username: data.name || data.slug };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
