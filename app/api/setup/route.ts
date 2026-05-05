// app/api/setup/route.ts
// Manage the GCP service account key — stored encrypted in the `service_account`
// table. Auth-gated: only signed-in users on the allowlist may upload/delete.
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  deleteServiceAccount,
  getServiceAccountEmail,
  hasServiceAccount,
  saveServiceAccount,
} from '@/lib/google';

export const dynamic = 'force-dynamic';

async function requireAuth() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
  }
  return null;
}

export async function GET() {
  const exists = await hasServiceAccount();
  const email = exists ? await getServiceAccountEmail() : null;
  return NextResponse.json({ exists, valid: !!email, email });
}

// Upload/replace the service account JSON
export async function POST(req: Request) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  try {
    const body = (await req.json()) as { json: string };
    if (!body.json) {
      return NextResponse.json({ ok: false, error: 'json field required' }, { status: 400 });
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body.json);
    } catch {
      return NextResponse.json({ ok: false, error: 'File is not valid JSON' }, { status: 400 });
    }
    if (
      parsed.type !== 'service_account' ||
      typeof parsed.client_email !== 'string' ||
      typeof parsed.private_key !== 'string'
    ) {
      return NextResponse.json(
        { ok: false, error: 'This does not look like a Google service account key file.' },
        { status: 400 }
      );
    }
    await saveServiceAccount(parsed as Parameters<typeof saveServiceAccount>[0]);
    return NextResponse.json({ ok: true, email: parsed.client_email });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE() {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  await deleteServiceAccount();
  return NextResponse.json({ ok: true });
}
