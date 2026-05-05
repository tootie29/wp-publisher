// app/page.tsx
import Link from 'next/link';
import { listProjectsForUser } from '@/lib/projects';
import { auth } from '@/lib/auth';
import { getServiceAccountEmail } from '@/lib/google';
import fs from 'node:fs';
import path from 'node:path';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

function hasServiceAccount() {
  const p = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || './config/service-account.json';
  const full = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  return fs.existsSync(full);
}

export default async function Home() {
  const session = await auth();
  const projects = await listProjectsForUser(session?.user?.email);
  const sa = hasServiceAccount() ? getServiceAccountEmail() : null;
  const configured = !!sa;

  return (
    <>
      <main className="max-w-6xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-semibold mb-2">RichardMedina Dashboard</h1>
        <p className="text-white/60 mb-8">Tools for your client work. First up: WP Publisher.</p>

        {/* Setup banner */}
        {!configured ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 mb-8 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="font-medium text-amber-300">First-time setup needed</div>
              <div className="text-sm text-white/70 mt-1">
                Upload your Google service account key to get started. Only takes a minute.
              </div>
            </div>
            <Link
              href="/setup"
              className="text-sm px-4 py-2 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 whitespace-nowrap"
            >
              Go to setup →
            </Link>
          </div>
        ) : (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 mb-8 flex items-center gap-3 text-sm">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-white/70">
              Service account configured: <code className="text-emerald-300">{sa}</code>
            </span>
            <Link href="/setup" className="ml-auto text-white/40 hover:text-white/70 text-xs">
              Manage →
            </Link>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Link
            href="/wp-publisher"
            className="block rounded-xl border border-white/10 hover:border-white/30 bg-white/[0.02] p-6 transition"
          >
            <div className="text-sm text-emerald-400 mb-2">Active</div>
            <div className="text-xl font-semibold">WP Publisher</div>
            <div className="text-white/60 text-sm mt-2">
              Watches client Google Sheets for "In-Progress" rows and publishes drafts to WordPress automatically.
            </div>
            <div className="text-white/40 text-xs mt-4">{projects.length} project(s) configured</div>
          </Link>
        </div>
      </main>
    </>
  );
}
