// GET /api/projects/[id]/terms
// Every category and tag on the project's WordPress site. Feeds the Published
// tab's term autocomplete so users pick existing terms instead of accidentally
// creating near-duplicates ("DUI Defense" vs "DUI defense").
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { ownsProject } from '@/lib/users';
import { clearTaxonomySupportCache, listTerms, supportsTerms } from '@/lib/wordpress';

export const dynamic = 'force-dynamic';

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

  // Escape hatch for "I just installed the mu-plugin and the dashboard still
  // says n/a": skip the (short) support cache and ask WordPress again.
  if (new URL(req.url).searchParams.get('recheck') === '1') {
    clearTaxonomySupportCache();
  }

  try {
    // `supports` tells the UI which routes actually have taxonomies on this
    // site, so the editor is only disabled when WordPress really would reject
    // the write — rather than assuming pages never take terms.
    const [categories, tags, postOk, pageOk] = await Promise.all([
      listTerms(project, 'categories'),
      listTerms(project, 'tags'),
      supportsTerms(project, 'post'),
      supportsTerms(project, 'page'),
    ]);
    return NextResponse.json({
      categories: categories.map((t) => t.name),
      tags: tags.map((t) => t.name),
      supports: { post: postOk, page: pageOk },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
