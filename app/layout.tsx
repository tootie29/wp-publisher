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

// Boot the background poller once per server process
if (typeof window === 'undefined') {
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
