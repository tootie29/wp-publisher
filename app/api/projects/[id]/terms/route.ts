// GET /api/projects/[id]/terms
// Every category and tag on the project's WordPress site. Feeds the Published
// tab's term autocomplete so users pick existing terms instead of accidentally
// creating near-duplicates ("DUI Defense" vs "DUI defense").
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { ownsProject } from '@/lib/users';
import { listTerms } from '@/lib/wordpress';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const project = await getProject(params.id);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!ownsProject(project.ownerEmail, session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const [categories, tags] = await Promise.all([
      listTerms(project, 'categories'),
      listTerms(project, 'tags'),
    ]);
    return NextResponse.json({
      categories: categories.map((t) => t.name),
      tags: tags.map((t) => t.name),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
