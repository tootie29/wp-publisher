// app/api/projects/[id]/connector/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import {
  type ConnectorCookie,
  type ConnectorSource,
  clearCookies,
  saveCookies,
  statusFor,
} from '@/lib/connector';

export const dynamic = 'force-dynamic';

function isSource(s: string | null): s is ConnectorSource {
  return s === 'surfer' || s === 'frase';
}

async function requireAuth(): Promise<NextResponse | null> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
  }
  return null;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const unauth = await requireAuth();
  if (unauth) return unauth;
  if (!getProject(params.id)) {
    return NextResponse.json({ ok: false, error: 'Project not found' }, { status: 404 });
  }
  return NextResponse.json(statusFor(params.id));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const unauth = await requireAuth();
  if (unauth) return unauth;
  if (!getProject(params.id)) {
    return NextResponse.json({ ok: false, error: 'Project not found' }, { status: 404 });
  }

  const url = new URL(req.url);
  const source = url.searchParams.get('source');
  if (!isSource(source)) {
    return NextResponse.json({ ok: false, error: 'Invalid source' }, { status: 400 });
  }

  let body: {
    cookies?: ConnectorCookie[];
    localStorage?: Record<string, string>;
    sessionStorage?: Record<string, string>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(body.cookies) || body.cookies.length === 0) {
    return NextResponse.json({ ok: false, error: 'No cookies provided' }, { status: 400 });
  }

  saveCookies(params.id, source, body.cookies, body.localStorage, body.sessionStorage);
  return NextResponse.json({
    ok: true,
    source,
    count: body.cookies.length,
    localStorageKeys: body.localStorage ? Object.keys(body.localStorage).length : 0,
  });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const unauth = await requireAuth();
  if (unauth) return unauth;
  const url = new URL(req.url);
  const source = url.searchParams.get('source');
  if (!isSource(source)) {
    return NextResponse.json({ ok: false, error: 'Invalid source' }, { status: 400 });
  }
  const removed = clearCookies(params.id, source);
  return NextResponse.json({ ok: true, removed });
}
