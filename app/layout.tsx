// app/layout.tsx
import './globals.css';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { startScheduler } from '@/lib/scheduler';
import Nav from '@/components/Nav';

export const metadata: Metadata = {
  title: 'RM Dashboard',
  description: 'WP Publisher and project tools',
};

// Boot the in-process poller for long-lived servers only (local dev, VPS).
// On Vercel the runtime is serverless — setInterval can't survive between
// invocations, so the poller is replaced by Vercel Cron hitting /api/worker/run.
if (typeof window === 'undefined' && !process.env.VERCEL) {
  try { startScheduler(); } catch (e) { console.error('scheduler failed to start', e); }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading headers forces this layout to be dynamic so Nav re-renders per request.
  headers();
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
