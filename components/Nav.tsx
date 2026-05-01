// components/Nav.tsx
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { signOutAction } from '@/lib/auth-actions';

export default async function Nav() {
  const session = await auth();
  return (
    <nav className="border-b border-white/10 bg-black/30 backdrop-blur sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="font-semibold tracking-tight">
          <span className="text-white">RM</span>
          <span className="text-white/50"> / Dashboard</span>
        </Link>
        <div className="flex gap-5 text-sm items-center">
          <Link href="/" className="text-white/70 hover:text-white">Overview</Link>
          <Link href="/wp-publisher" className="text-white/70 hover:text-white">WP Publisher</Link>
          <Link href="/wp-publisher/logs" className="text-white/70 hover:text-white">Logs</Link>
          <Link href="/setup" className="text-white/70 hover:text-white">Setup</Link>
          {session?.user && (
            <>
              <span className="text-white/30">|</span>
              <span className="text-white/50 hidden sm:inline">{session.user.email}</span>
              <form action={signOutAction}>
                <button type="submit" className="text-white/70 hover:text-white">
                  Sign out
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
