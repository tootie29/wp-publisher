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

// Category/tag term ids to assign. Post-route only — WordPress pages have no
// taxonomies and reject these params.
export interface PostTerms {
  categories?: number[];
  tags?: number[];
}

export async function createDraft(
  project: ProjectConfig,
  route: PageTypeRoute,
  title: string,
  htmlContent: string,
  // Optional UTC publish date ("YYYY-MM-DDTHH:MM:SS"). When set, the post's
  // date is stamped to this slot. Status is left as the project's publishStatus
  // — so a 'draft' stays a dated draft, while a 'publish' project lets WP
  // schedule it as 'future' automatically.
  dateGmt?: string,
  terms?: PostTerms
): Promise<{ id: number; link: string; editLink: string }> {
  const body: Record<string, unknown> = {
    title,
    content: htmlContent,
    status: project.publishStatus, // usually 'draft'
  };
  if (dateGmt) body.date_gmt = dateGmt;
  if (route === 'post') {
    if (terms?.categories?.length) body.categories = terms.categories;
    if (terms?.tags?.length) body.tags = terms.tags;
  }
  const res = await fetch(endpoint(project, route), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(project),
    },
    body: JSON.stringify(body),
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

  // 2. Search fallback — but only accept an EXACT normalized-title match.
  // We deliberately do NOT accept a lone fuzzy search hit: WordPress search is
  // loose (it matched "About Our Firm" for "Rapid City DUI Lawyer"), and
  // accepting that silently overwrites an unrelated page. No exact match here
  // means "no match" → the caller creates a new post instead.
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
  title?: string,
  terms?: PostTerms
): Promise<{ id: number; link: string; editLink: string }> {
  const base = project.wordpress.baseUrl.replace(/\/+$/, '');
  const path = route === 'post' ? 'posts' : 'pages';
  const body: Record<string, unknown> = { content: htmlContent };
  if (title) body.title = title;
  if (route === 'post') {
    if (terms?.categories?.length) body.categories = terms.categories;
    if (terms?.tags?.length) body.tags = terms.tags;
  }
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

// Resolve category/tag names from the sheet into WordPress term ids, creating
// any that don't exist yet. WP's REST API only accepts term ids on a post, so
// this lookup is unavoidable.
//
// Matching is case-insensitive on the term name, and also checks the slug —
// "Criminal Defense" and "criminal-defense" are the same term to WordPress, and
// creating a duplicate would silently 400 with `term_exists`. We treat that
// error as a hit and reuse the id it reports.
//
// Best-effort per name: a term that can't be resolved is logged by the caller
// and dropped rather than failing the whole row.
export async function resolveTerms(
  project: ProjectConfig,
  taxonomy: 'categories' | 'tags',
  names: string[]
): Promise<{ ids: number[]; created: string[]; failed: { name: string; error: string }[] }> {
  const base = project.wordpress.baseUrl.replace(/\/+$/, '');
  const ids: number[] = [];
  const created: string[] = [];
  const failed: { name: string; error: string }[] = [];

  for (const name of names) {
    const wanted = name.trim().toLowerCase();
    const wantedSlug = slugify(name);
    try {
      // 1. Look for an existing term. `search` is fuzzy, so compare exactly.
      const res = await fetch(
        `${base}/wp-json/wp/v2/${taxonomy}?search=${encodeURIComponent(name)}&per_page=100&_fields=id,name,slug`,
        { headers: { Authorization: authHeader(project) }, cache: 'no-store' }
      );
      if (res.ok) {
        const list = (await res.json()) as Array<{ id: number; name: string; slug: string }>;
        const hit = list.find(
          (t) =>
            normalizeTitle(t.name) === normalizeTitle(name) ||
            (t.name || '').trim().toLowerCase() === wanted ||
            (wantedSlug && t.slug === wantedSlug)
        );
        if (hit) {
          ids.push(hit.id);
          continue;
        }
      }

      // 2. Not found — create it.
      const createRes = await fetch(`${base}/wp-json/wp/v2/${taxonomy}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader(project) },
        body: JSON.stringify({ name }),
      });
      if (createRes.ok) {
        const data = (await createRes.json()) as { id: number };
        ids.push(data.id);
        created.push(name);
        continue;
      }

      // WP returns 400 `term_exists` when the name collides with a term the
      // search above missed (e.g. a child term). The existing id comes back in
      // the error payload — use it.
      const errBody = (await createRes.json().catch(() => null)) as {
        code?: string;
        message?: string;
        data?: { term_id?: number; status?: number };
      } | null;
      if (errBody?.code === 'term_exists' && errBody.data?.term_id) {
        ids.push(errBody.data.term_id);
        continue;
      }
      failed.push({
        name,
        error: errBody?.message || `${createRes.status} creating ${taxonomy} term`,
      });
    } catch (e) {
      failed.push({ name, error: (e as Error).message });
    }
  }

  return { ids, created, failed };
}

// Every category/tag on the site, for the dashboard's term autocomplete and for
// turning a post's term ids back into names. Pages through WP's 100-per-page
// cap; stops at 1000 terms (well past any sane site's category list).
export async function listTerms(
  project: ProjectConfig,
  taxonomy: 'categories' | 'tags'
): Promise<{ id: number; name: string }[]> {
  const base = project.wordpress.baseUrl.replace(/\/+$/, '');
  const out: { id: number; name: string }[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `${base}/wp-json/wp/v2/${taxonomy}?per_page=100&page=${page}&orderby=name&order=asc&_fields=id,name`,
      { headers: { Authorization: authHeader(project) }, cache: 'no-store' }
    );
    if (!res.ok) break;
    const list = (await res.json()) as { id: number; name: string }[];
    out.push(...list);
    if (list.length < 100) break;
  }
  return out;
}

// Replace a post's categories/tags without touching its content. Unlike the
// create/update paths, an empty array IS sent here — clearing every term is a
// legitimate edit when the user removes the last chip.
export async function setPostTerms(
  project: ProjectConfig,
  route: PageTypeRoute,
  postId: number,
  terms: PostTerms
): Promise<{ categories: number[]; tags: number[] }> {
  if (route !== 'post') {
    throw new Error('WordPress pages have no categories or tags');
  }
  const base = project.wordpress.baseUrl.replace(/\/+$/, '');
  const body: Record<string, unknown> = {};
  if (terms.categories) body.categories = terms.categories;
  if (terms.tags) body.tags = terms.tags;
  if (Object.keys(body).length === 0) throw new Error('No taxonomies to update');

  const res = await fetch(`${base}/wp-json/wp/v2/posts/${postId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader(project) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WP term update on post ${postId} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { categories?: number[]; tags?: number[] };
  return { categories: data.categories || [], tags: data.tags || [] };
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

// Flip an existing post/page to "publish" and return its live URL. Used by the
// dashboard's "Publish" button on the Drafts tab.
export async function publishPost(
  project: ProjectConfig,
  route: PageTypeRoute,
  postId: number
): Promise<{ id: number; link: string; editLink: string }> {
  const base = project.wordpress.baseUrl.replace(/\/+$/, '');
  const path = route === 'post' ? 'posts' : 'pages';
  const res = await fetch(`${base}/wp-json/wp/v2/${path}/${postId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader(project) },
    body: JSON.stringify({ status: 'publish' }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WP publish ${route} ${postId} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { id: number; link: string };
  const editLink = `${base}/wp-admin/post.php?post=${data.id}&action=edit`;
  return { id: data.id, link: data.link, editLink };
}

// Upload an image (raw bytes) to the WordPress media library. Returns the new
// media id and its public source URL so callers can rewrite <img src> to point
// at the WP-hosted copy instead of the (often expiring) original.
export async function uploadMedia(
  project: ProjectConfig,
  bytes: Uint8Array,
  filename: string,
  contentType: string
): Promise<{ id: number; sourceUrl: string }> {
  const base = project.wordpress.baseUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/wp-json/wp/v2/media`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(project),
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
    body: new Blob([bytes as unknown as BlobPart], { type: contentType }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WP media upload failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { id: number; source_url: string };
  return { id: data.id, sourceUrl: data.source_url };
}

// Return the date (UTC) of the most recent blog post on the WP site, counting
// both already-published and scheduled-future posts. Used to space out new
// blog posts. Returns null if there are none or the query fails.
export async function getLatestPostDate(project: ProjectConfig): Promise<Date | null> {
  const base = project.wordpress.baseUrl.replace(/\/+$/, '');
  try {
    const res = await fetch(
      `${base}/wp-json/wp/v2/posts?status=publish,future&orderby=date&order=desc&per_page=1&_fields=date_gmt&context=edit`,
      { headers: { Authorization: authHeader(project) }, cache: 'no-store' }
    );
    if (!res.ok) return null;
    const list = (await res.json()) as Array<{ date_gmt?: string }>;
    const raw = list[0]?.date_gmt;
    if (!raw) return null;
    // WP returns naive UTC ("2026-06-20T09:00:00"); append Z so it parses as UTC.
    const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
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
