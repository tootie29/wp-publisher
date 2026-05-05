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
import { userKey, ownsProject } from '@/lib/users';

export const dynamic = 'force-dynamic';

function isSource(s: string | null): s is ConnectorSource {
  return s === 'surfer' || s === 'frase';
}

async function requireAuth() {
  const session = await auth();
  if (!session?.user?.email) {
    return { error: NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 }) };
  }
  return { email: session.user.email };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, email } = await requireAuth();
  if (error) return error;

  const project = await getProject(params.id);
  if (!project) {
    return NextResponse.json({ ok: false, error: 'Project not found' }, { status: 404 });
  }
  if (!ownsProject(project.ownerEmail, email)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json(await statusFor(userKey(email!), params.id));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, email } = await requireAuth();
  if (error) return error;

  const project = await getProject(params.id);
  if (!project) {
    return NextResponse.json({ ok: false, error: 'Project not found' }, { status: 404 });
  }
  if (!ownsProject(project.ownerEmail, email)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
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

  await saveCookies(userKey(email!), params.id, source, body.cookies, body.localStorage, body.sessionStorage);
  return NextResponse.json({
    ok: true,
    source,
    count: body.cookies.length,
    localStorageKeys: body.localStorage ? Object.keys(body.localStorage).length : 0,
  });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { error, email } = await requireAuth();
  if (error) return error;

  const url = new URL(req.url);
  const source = url.searchParams.get('source');
  if (!isSource(source)) {
    return NextResponse.json({ ok: false, error: 'Invalid source' }, { status: 400 });
  }
  const removed = await clearCookies(userKey(email!), params.id, source);
  return NextResponse.json({ ok: true, removed });
}
