// app/api/projects/[id]/wp-published/[postId]/route.ts
// Inline-edits a published WP post/page from the dashboard:
//   - Yoast SEO fields (title, description, focus keyphrase), via the
//     wp-publisher-yoast-rest.php mu-plugin's REST-exposed meta keys
//   - categories/tags (posts only), sent as names and resolved to term ids

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { ownsProject } from '@/lib/users';
import { listTerms, resolveTerms, setPostTerms, updateYoastMeta } from '@/lib/wordpress';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; postId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const project = await getProject(params.id);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!ownsProject(project.ownerEmail, session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const postId = parseInt(params.postId, 10);
  if (!Number.isFinite(postId) || postId <= 0) {
    return NextResponse.json({ error: 'Invalid postId' }, { status: 400 });
  }

  let body: {
    type?: 'post' | 'page';
    metaTitle?: string;
    metaDescription?: string;
    keyword?: string;
    categories?: unknown;
    tags?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.type !== 'post' && body.type !== 'page') {
    return NextResponse.json({ error: 'type must be "post" or "page"' }, { status: 400 });
  }

  const fields: { metaTitle?: string; metaDescription?: string; keyword?: string } = {};
  if (typeof body.metaTitle === 'string') fields.metaTitle = body.metaTitle;
  if (typeof body.metaDescription === 'string') fields.metaDescription = body.metaDescription;
  if (typeof body.keyword === 'string') fields.keyword = body.keyword;

  // Taxonomy edits arrive as name arrays; an empty array is meaningful (clear
  // every term), so presence is what counts, not length.
  const isNameList = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((s) => typeof s === 'string');
  const wantsCategories = body.categories !== undefined;
  const wantsTags = body.tags !== undefined;
  if ((wantsCategories && !isNameList(body.categories)) || (wantsTags && !isNameList(body.tags))) {
    return NextResponse.json(
      { error: 'categories and tags must be arrays of term names' },
      { status: 400 }
    );
  }
  const wantsTerms = wantsCategories || wantsTags;

  if (Object.keys(fields).length === 0 && !wantsTerms) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  }
  if (wantsTerms && body.type !== 'post') {
    return NextResponse.json(
      { error: 'WordPress pages have no categories or tags' },
      { status: 400 }
    );
  }

  try {
    const result: Record<string, unknown> = { ok: true };

    if (Object.keys(fields).length > 0) {
      Object.assign(result, await updateYoastMeta(project, body.type, postId, fields));
    }

    if (wantsTerms) {
      // Names → ids, creating any that are new. A name that can't be resolved
      // is reported back rather than silently dropped: unlike the worker, a
      // person is watching this edit and should see it fail.
      const resolved: { categories?: number[]; tags?: number[] } = {};
      const failed: { name: string; error: string }[] = [];
      const created: string[] = [];
      for (const taxonomy of ['categories', 'tags'] as const) {
        const names = body[taxonomy];
        if (names === undefined) continue;
        const r = await resolveTerms(project, taxonomy, names as string[]);
        resolved[taxonomy] = r.ids;
        created.push(...r.created);
        failed.push(...r.failed);
      }
      if (failed.length) {
        return NextResponse.json(
          { error: `Couldn't save ${failed.map((f) => `"${f.name}" (${f.error})`).join(', ')}` },
          { status: 502 }
        );
      }

      await setPostTerms(project, 'post', postId, resolved);

      // Echo back names (not ids) so the UI can render chips directly. Read
      // them from the site so the response reflects WP's canonical spelling of
      // a term the user typed in different case.
      const nameById = new Map<number, string>();
      for (const taxonomy of ['categories', 'tags'] as const) {
        if (resolved[taxonomy] === undefined) continue;
        for (const t of await listTerms(project, taxonomy)) nameById.set(t.id, t.name);
      }
      if (resolved.categories) {
        result.categories = resolved.categories.map((id) => nameById.get(id) || '').filter(Boolean);
      }
      if (resolved.tags) {
        result.tags = resolved.tags.map((id) => nameById.get(id) || '').filter(Boolean);
      }
      if (created.length) {
        log(project.id, 'info', `Created new terms from the dashboard: ${created.join(', ')}`, {
          created,
          postId,
        });
      }
    }

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
