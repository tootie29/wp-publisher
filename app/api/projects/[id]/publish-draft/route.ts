// POST /api/projects/[id]/publish-draft  { rowIndex }
// Publishes the draft created for a sheet row (sets its WP status to "publish")
// and writes the resulting live URL back to the sheet — into the Published URL
// column if mapped, otherwise the Target URL column.
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { ownsProject } from '@/lib/users';
import { getProcessedRecord, markProcessed } from '@/lib/state';
import { publishPost } from '@/lib/wordpress';
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

  const body = (await req.json().catch(() => ({}))) as { rowIndex?: number };
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

  // 1. Publish in WordPress.
  let wp;
  try {
    wp = await publishPost(project, rec.route, rec.wpId);
  } catch (e) {
    log(project.id, 'error', `Publish failed for row ${rowIndex}: ${(e as Error).message}`, { wpId: rec.wpId }, rowIndex);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  // 2. Write the live URL back to the sheet — Published URL column preferred,
  // Target URL column as fallback.
  const column = project.sheet.columns.publishedUrl || project.sheet.columns.targetUrl || '';
  let wroteToSheet = false;
  let sheetError: string | undefined;
  if (column) {
    try {
      await setCellValue(project, column, rowIndex, wp.link);
      wroteToSheet = true;
    } catch (e) {
      sheetError = (e as Error).message;
      log(project.id, 'warn', `Published row ${rowIndex} but failed to write URL to column ${column}: ${sheetError}`, { wpId: rec.wpId, link: wp.link }, rowIndex);
    }
  }

  // Keep the local ledger's public link in sync with the now-live URL.
  await markProcessed({ ...rec, wpLink: wp.link, editLink: wp.editLink });

  log(project.id, 'success', `Published live: ${rec.title}`, { wpId: rec.wpId, link: wp.link, route: rec.route, column: wroteToSheet ? column : null }, rowIndex);

  return NextResponse.json({
    ok: true,
    link: wp.link,
    wroteToSheet,
    column: wroteToSheet ? column : null,
    sheetError,
  });
}
