// app/api/setup/route.ts
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getServiceAccountEmail } from '@/lib/google';

export const dynamic = 'force-dynamic';

function keyFilePath() {
  const p = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || './config/service-account.json';
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

export async function GET() {
  const file = keyFilePath();
  const exists = fs.existsSync(file);
  let email: string | null = null;
  let valid = false;
  if (exists) {
    try {
      email = getServiceAccountEmail();
      valid = !!email;
    } catch {}
  }
  return NextResponse.json({ exists, valid, email });
}

// Upload/replace the service account JSON
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { json: string };
    if (!body.json) {
      return NextResponse.json({ ok: false, error: 'json field required' }, { status: 400 });
    }
    // Validate JSON and that it looks like a service account key
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body.json);
    } catch {
      return NextResponse.json({ ok: false, error: 'File is not valid JSON' }, { status: 400 });
    }
    if (parsed.type !== 'service_account' || !parsed.client_email || !parsed.private_key) {
      return NextResponse.json(
        { ok: false, error: 'This does not look like a Google service account key file.' },
        { status: 400 }
      );
    }
    const file = keyFilePath();
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(parsed, null, 2));
    return NextResponse.json({ ok: true, email: parsed.client_email });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE() {
  const file = keyFilePath();
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return NextResponse.json({ ok: true });
}
