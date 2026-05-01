// middleware.ts
import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/lib/auth.config';

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Public paths — auth handlers, login page, static assets.
  if (
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  if (!req.auth) {
    // Build the redirect off NEXTAUTH_URL when set so we never accidentally
    // emit http:// behind a TLS-terminating proxy that strips X-Forwarded-Proto
    // (e.g. LiteSpeed/Passenger on cPanel).
    const base =
      process.env.NEXTAUTH_URL ||
      `${req.nextUrl.protocol}//${req.nextUrl.host}`;
    const url = new URL('/login', base);
    if (pathname !== '/') url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
