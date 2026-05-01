// app/setup/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, AlertCircle, Upload, Loader2, Copy, Check } from 'lucide-react';

export default function SetupPage() {
  const router = useRouter();
  const [status, setStatus] = useState<{ exists: boolean; valid: boolean; email: string | null } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    const res = await fetch('/api/setup');
    setStatus(await res.json());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);
    try {
      const text = await file.text();
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: text }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    if (!confirm('Remove the service account key? You will need to re-upload it to use the dashboard.')) return;
    await fetch('/api/setup', { method: 'DELETE' });
    await refresh();
  }

  async function copyEmail() {
    if (!status?.email) return;
    await navigator.clipboard.writeText(status.email);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <main className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-semibold mb-2">Setup</h1>
        <p className="text-white/60 mb-10">
          One-time: upload your Google service account key. After that, everything else is configured per-project.
        </p>

        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            Google service account
            {status?.valid ? (
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Configured
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Missing
              </span>
            )}
          </h2>

          {status?.valid ? (
            <>
              <p className="text-sm text-white/60 mb-3">Active service account email:</p>
              <div className="flex items-center gap-2 bg-black/30 border border-white/10 rounded px-3 py-2 mb-4">
                <code className="text-sm text-emerald-300 flex-1 break-all">{status.email}</code>
                <button
                  onClick={copyEmail}
                  className="text-xs px-2 py-1 rounded border border-white/10 hover:border-white/30 inline-flex items-center gap-1"
                >
                  {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                </button>
              </div>
              <p className="text-sm text-white/50 mb-4">
                Share client Google Sheets and Google Docs with this email (Editor for sheets, Viewer for docs).
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => router.push('/wp-publisher')}
                  className="text-sm px-4 py-2 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300"
                >
                  Continue to WP Publisher →
                </button>
                <button
                  onClick={remove}
                  className="text-sm px-4 py-2 rounded border border-red-500/20 hover:border-red-500/40 text-red-300"
                >
                  Replace / Remove
                </button>
              </div>
            </>
          ) : (
            <>
              <Instructions />
              <label className="block mt-6 cursor-pointer">
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
                <div className="rounded-lg border-2 border-dashed border-white/15 hover:border-white/30 p-8 text-center transition">
                  {uploading ? (
                    <><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Uploading…</>
                  ) : (
                    <>
                      <Upload className="w-6 h-6 mx-auto mb-2 text-white/60" />
                      <div className="text-white/80 font-medium">Click to upload service account JSON</div>
                      <div className="text-white/40 text-xs mt-1">
                        The file you downloaded from Google Cloud (looks like <code>project-xxx-abc123.json</code>)
                      </div>
                    </>
                  )}
                </div>
              </label>
              {error && (
                <div className="mt-4 text-sm text-red-400 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  {error}
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </>
  );
}

function Instructions() {
  return (
    <ol className="text-sm text-white/70 space-y-3 list-decimal pl-5">
      <li>
        Go to <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300">console.cloud.google.com</a> and create a project (or pick an existing one)
      </li>
      <li>
        In the search bar, find and enable each of these APIs: <strong>Google Sheets API</strong>, <strong>Google Docs API</strong>, <strong>Google Drive API</strong>
      </li>
      <li>
        Navigate to <strong>IAM & Admin → Service Accounts → Create Service Account</strong>. Name it anything (e.g. "rm-dashboard"). Skip the optional role step.
      </li>
      <li>
        Click the service account you just created → <strong>Keys</strong> tab → <strong>Add Key → Create new key → JSON</strong>. A file downloads.
      </li>
      <li>Upload that JSON file below.</li>
    </ol>
  );
}
