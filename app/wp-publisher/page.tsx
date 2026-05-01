// app/wp-publisher/page.tsx
import Link from 'next/link';
import ProjectList from '@/components/ProjectList';
import { listProjects, publicProject } from '@/lib/projects';
import { Plus, FileText } from 'lucide-react';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';

function hasServiceAccount() {
  const p = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || './config/service-account.json';
  const full = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  return fs.existsSync(full);
}

export default function WpPublisherPage() {
  const projects = listProjects().map(publicProject);
  const configured = hasServiceAccount();
  const pollMins = process.env.POLL_INTERVAL_MINUTES || 5;

  return (
    <main className="max-w-screen-2xl mx-auto px-6 py-10">
      <div className="flex items-end justify-between mb-2 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold">WP Publisher</h1>
          <p className="text-white/60 mt-1 text-sm">
            Each project watches a Google Sheet and creates WordPress drafts when content is ready. Auto-checks every {pollMins} minutes.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/wp-publisher/logs"
            className="text-sm text-white/70 hover:text-white border border-white/10 hover:border-white/30 rounded-lg px-3 py-2 inline-flex items-center gap-2"
          >
            <FileText className="w-4 h-4" /> View logs
          </Link>
          <Link
            href="/wp-publisher/new"
            className={`text-sm px-3 py-2 rounded-lg inline-flex items-center gap-2 border ${
              configured
                ? 'bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-500/30 text-emerald-300'
                : 'border-white/10 text-white/30 pointer-events-none'
            }`}
          >
            <Plus className="w-4 h-4" /> Add project
          </Link>
        </div>
      </div>

      {!configured && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 my-6 text-sm">
          <span className="text-amber-300 font-medium">Setup required:</span>{' '}
          <span className="text-white/70">Upload your Google service account key before adding projects.</span>{' '}
          <Link href="/setup" className="text-amber-300 hover:text-amber-200 underline ml-1">
            Go to setup
          </Link>
        </div>
      )}

      <div className="mt-8">
        {projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/15 p-10 text-center">
            <p className="text-white/70 mb-1">No projects yet</p>
            <p className="text-sm text-white/40 mb-4">
              A project links one Google Sheet to one WordPress site. Add your first one to get started.
            </p>
            {configured && (
              <Link
                href="/wp-publisher/new"
                className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300"
              >
                <Plus className="w-4 h-4" /> Add your first project
              </Link>
            )}
          </div>
        ) : (
          <ProjectList projects={projects} />
        )}
      </div>
    </main>
  );
}
