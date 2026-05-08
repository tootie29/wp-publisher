// app/api/projects/[id]/wp-published/[postId]/route.ts
// Inline-edits Yoast SEO fields (title, description, focus keyphrase) on a
// published WP post/page. Hits the wp-publisher-yoast-rest.php mu-plugin's
// REST-exposed meta keys.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { ownsProject } from '@/lib/users';
import { updateYoastMeta } from '@/lib/wordpress';

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

  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  }

  try {
    const updated = await updateYoastMeta(project, body.type, postId, fields);
    return NextResponse.json({ ok: true, ...updated });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
