// POST /api/projects/[id]/sync-urls
// Reconciles the sheet's URL column with what WordPress actually has.
//
// Serves two jobs at once:
//  - Repair: clears the ?p=<id> placeholders an earlier bug wrote as though they
//    were published URLs. They 401 for visitors and change once the post goes
//    live, so an empty cell is more honest than a link that lies.
//  - Fill in: blogs that spacing scheduled into the future have no URL when you
//    hit Publish. Once their date passes and WordPress makes them live, this
//    writes the real permalink in.
//
// Only ever writes a genuine permalink, or clears a placeholder. A cell holding
// a real URL is left alone, and a post we can't read is skipped rather than
// guessed at.
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { ownsProject } from '@/lib/users';
import { getProcessed } from '@/lib/state';
import { fetchPostStates, isPlaceholderLink } from '@/lib/wordpress';
import { readColumn, setCellValues } from '@/lib/sheets';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
  }
  const project = await getProject(params.id);
  if (!project) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  if (!ownsProject(project.ownerEmail, session.user.email)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const column = project.sheet.columns.publishedUrl || project.sheet.columns.targetUrl || '';
  if (!column) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'No Published URL or Target URL column is mapped for this project, so there is nowhere to write URLs. Set one in Edit project.',
      },
      { status: 400 }
    );
  }

  const records = await getProcessed(project.id);
  if (!records.length) {
    return NextResponse.json({ ok: true, checked: 0, filled: 0, cleared: 0, scheduled: 0 });
  }

  try {
    const [states, current] = await Promise.all([
      fetchPostStates(project, records.map((r) => ({ wpId: r.wpId, route: r.route }))),
      readColumn(project, column),
    ]);

    const updates: { columnLetter: string; rowIndex: number; value: string }[] = [];
    let filled = 0;
    let cleared = 0;
    let scheduled = 0;
    let unknown = 0;

    for (const rec of records) {
      const state = states.get(rec.wpId);
      if (!state) {
        unknown += 1; // deleted, trashed, or unreadable — don't touch the cell
        continue;
      }
      const cell = current.get(rec.rowIndex) || '';
      const live = state.status === 'publish' && !isPlaceholderLink(state.link);

      if (live) {
        // Only write when it would actually change something.
        if (cell !== state.link) {
          updates.push({ columnLetter: column, rowIndex: rec.rowIndex, value: state.link });
          filled += 1;
        }
        continue;
      }

      if (state.status === 'future') scheduled += 1;
      // Not live: a placeholder in the cell is the old bug's output — clear it.
      // Anything else (a real URL someone put there) is left alone.
      if (cell && isPlaceholderLink(cell)) {
        updates.push({ columnLetter: column, rowIndex: rec.rowIndex, value: '' });
        cleared += 1;
      }
    }

    await setCellValues(project, updates);

    log(project.id, 'info',
      `Synced sheet URLs in column ${column}: ${filled} filled in, ${cleared} placeholder(s) cleared, ` +
      `${scheduled} still scheduled, ${unknown} not readable in WordPress.`,
      { column, filled, cleared, scheduled, unknown, checked: records.length }
    );

    return NextResponse.json({
      ok: true,
      column,
      checked: records.length,
      filled,
      cleared,
      scheduled,
      unknown,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
