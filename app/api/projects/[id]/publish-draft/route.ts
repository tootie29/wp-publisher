// POST /api/projects/[id]/publish-draft  { rowIndex }
// Publishes the draft created for a sheet row (sets its WP status to "publish")
// and writes the resulting live URL back to the sheet — into the Published URL
// column if mapped, otherwise the Target URL column.
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { ownsProject } from '@/lib/users';
import { getProcessedRecord, markProcessed } from '@/lib/state';
import { isPlaceholderLink, publishPost } from '@/lib/wordpress';
import { setCellValue } from '@/lib/sheets';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
  }
  const project = await getProject(params.id);
  if (!project) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  }
  if (!ownsProject(project.ownerEmail, session.user.email)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    rowIndex?: number;
    publishNow?: boolean;
  };
  const rowIndex = body.rowIndex;
  if (typeof rowIndex !== 'number') {
    return NextResponse.json({ ok: false, error: 'rowIndex is required' }, { status: 400 });
  }

  const rec = await getProcessedRecord(project.id, rowIndex);
  if (!rec) {
    return NextResponse.json(
      { ok: false, error: `No published record for row ${rowIndex}` },
      { status: 404 }
    );
  }

  // 1. Publish in WordPress. `publishNow` clears any scheduled date so a blog
  // that spacing pushed into the future goes live immediately instead.
  let wp;
  try {
    wp = await publishPost(project, rec.route, rec.wpId, body.publishNow === true);
  } catch (e) {
    log(project.id, 'error', `Publish failed for row ${rowIndex}: ${(e as Error).message}`, { wpId: rec.wpId }, rowIndex);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  // WordPress doesn't always give you the status you asked for. A post carrying
  // a future date (blog spacing assigns one) comes back as `future` — scheduled,
  // not live — and its link is the ?p= placeholder, which 401s for visitors and
  // changes once it goes live. Writing that to the sheet as the published URL is
  // worse than writing nothing, so don't.
  const scheduled = wp.status === 'future';
  const isLive = wp.status === 'publish' && !isPlaceholderLink(wp.link);

  // 2. Write the live URL back to the sheet — Published URL column preferred,
  // Target URL column as fallback.
  const column = project.sheet.columns.publishedUrl || project.sheet.columns.targetUrl || '';
  let wroteToSheet = false;
  let sheetError: string | undefined;
  if (column && isLive) {
    try {
      await setCellValue(project, column, rowIndex, wp.link);
      wroteToSheet = true;
    } catch (e) {
      sheetError = (e as Error).message;
      log(project.id, 'warn', `Published row ${rowIndex} but failed to write URL to column ${column}: ${sheetError}`, { wpId: rec.wpId, link: wp.link }, rowIndex);
    }
  }

  // Keep the local ledger's link in sync. For a scheduled post this is still the
  // placeholder — that's fine here, it's only used for the dashboard's own
  // "View" link, never presented as the published URL.
  await markProcessed({ ...rec, wpLink: wp.link, editLink: wp.editLink });

  if (scheduled) {
    const when = wp.dateGmt ? `${wp.dateGmt.replace('T', ' ')} UTC` : 'a future date';
    log(project.id, 'warn',
      `Row ${rowIndex} is scheduled, not live: WordPress kept "${rec.title}" as a future post dated ${when}. ` +
      `Its blog spacing date is still in the future, so publishing scheduled it instead. No URL written to the sheet — ` +
      `it has none until it goes live. Use "Publish now" to override the schedule.`,
      { wpId: rec.wpId, status: wp.status, dateGmt: wp.dateGmt }, rowIndex
    );
    return NextResponse.json({
      ok: true,
      scheduled: true,
      status: wp.status,
      dateGmt: wp.dateGmt,
      link: wp.link,
      wroteToSheet: false,
      message:
        `Scheduled for ${when}, not live yet — its blog interval date is in the future. ` +
        `No URL was written to the sheet because it doesn't have one until it publishes.`,
    });
  }

  if (!isLive) {
    log(project.id, 'warn',
      `Row ${rowIndex}: WordPress returned status "${wp.status}" after publishing "${rec.title}", not "publish". ` +
      `No URL written to the sheet.`,
      { wpId: rec.wpId, status: wp.status, link: wp.link }, rowIndex
    );
    return NextResponse.json({
      ok: true,
      status: wp.status,
      link: wp.link,
      wroteToSheet: false,
      message: `WordPress left this as "${wp.status}" rather than publishing it, so no URL was written to the sheet.`,
    });
  }

  log(project.id, 'success', `Published live: ${rec.title}`, { wpId: rec.wpId, link: wp.link, route: rec.route, column: wroteToSheet ? column : null }, rowIndex);

  return NextResponse.json({
    ok: true,
    status: wp.status,
    link: wp.link,
    wroteToSheet,
    column: wroteToSheet ? column : null,
    sheetError,
  });
}
