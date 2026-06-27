// DELETE /api/projects/[id]/published/[rowIndex]
// Removes a single row from the processed ledger so the worker reprocesses it
// on the next run (the sheet row must be set back to the trigger status). Used
// by the Queue tab's "Re-queue" action. Does NOT touch the WordPress post.
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { ownsProject } from '@/lib/users';
import { removeProcessed } from '@/lib/state';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; rowIndex: string } }
) {
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
  const rowIndex = parseInt(params.rowIndex, 10);
  if (isNaN(rowIndex)) {
    return NextResponse.json({ ok: false, error: 'Invalid rowIndex' }, { status: 400 });
  }

  const removed = await removeProcessed(project.id, rowIndex);
  if (removed) {
    log(project.id, 'info', `Row ${rowIndex} re-queued (removed from publish history).`, {}, rowIndex);
  }
  return NextResponse.json({ ok: true, removed });
}
