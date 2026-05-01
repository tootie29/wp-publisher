'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Play, Loader2, ChevronRight, Pause, Inbox, FileText, Clock, Square, PlayCircle } from 'lucide-react';

export interface PublicProject {
  id: string;
  name: string;
  enabled: boolean;
  wordpress: { baseUrl: string };
  publishStatus: string;
}

type Status = 'running' | 'watching' | 'paused';

export default function ProjectRow({
  project: initialProject,
  isRunning,
}: {
  project: PublicProject;
  isRunning: boolean;
}) {
  const [project, setProject] = useState<PublicProject>(initialProject);
  const [queueCount, setQueueCount] = useState<number | null>(null);
  const [publishedTotal, setPublishedTotal] = useState<number | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [stopping, setStopping] = useState(false);

  const status: Status = isRunning ? 'running' : project.enabled ? 'watching' : 'paused';
  const busy = isRunning || triggering;

  async function refresh() {
    try {
      const [q, p] = await Promise.all([
        fetch(`/api/queue?projectId=${project.id}`).then((r) => r.json()),
        fetch(`/api/projects/${project.id}/published?limit=1`).then((r) => r.json()),
      ]);
      setQueueCount((q.queue || []).length);
      setPublishedTotal(p.summary?.totalPublished ?? 0);
      setLastRunAt(p.summary?.lastRunAt ?? null);
    } catch {
      /* swallow — keep stale values */
    }
  }

  async function runNow(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy || !project.enabled) return;
    setTriggering(true);
    try {
      await fetch('/api/worker/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      });
      await refresh();
    } finally {
      setTriggering(false);
    }
  }

  async function toggleEnabled(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (toggling) return;
    setToggling(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/toggle`, { method: 'POST' });
      const data = await res.json();
      if (data.ok && data.project) setProject(data.project);
    } finally {
      setToggling(false);
    }
  }

  async function stopRun(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (stopping) return;
    if (!confirm('Stop after the current item finishes?\n\nWork already in flight will complete, but no further rows will be processed.')) return;
    setStopping(true);
    try {
      await fetch('/api/worker/stop', { method: 'POST' });
    } finally {
      setStopping(false);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const host = project.wordpress.baseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');

  return (
    <Link
      href={`/wp-publisher/${project.id}`}
      className={`group block rounded-xl border bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/20 transition relative overflow-hidden ${
        status === 'running'
          ? 'border-blue-500/40 shadow-[0_0_0_1px_rgba(59,130,246,0.25),0_0_24px_rgba(59,130,246,0.12)]'
          : 'border-white/10'
      }`}
    >
      {status === 'running' && (
        <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden">
          <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-blue-400 to-transparent animate-[shimmer_1.6s_linear_infinite]" />
        </div>
      )}

      <div className="px-5 py-4 flex items-center gap-5">
        {/* Status indicator */}
        <div className="shrink-0 w-32">
          <StatusBadge status={status} />
        </div>

        {/* Identity */}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white truncate">{project.name}</div>
          <div className="text-xs text-white/50 truncate">{host}</div>
        </div>

        {/* Stats */}
        <div className="hidden md:flex items-center gap-6 shrink-0">
          <Stat
            icon={<Inbox className="w-3.5 h-3.5" />}
            label="In queue"
            value={
              queueCount === null
                ? '…'
                : queueCount === 0
                ? 'Up to date'
                : `${queueCount} waiting`
            }
            tone={queueCount && queueCount > 0 ? 'amber' : 'muted'}
          />
          <Stat
            icon={<FileText className="w-3.5 h-3.5" />}
            label="Published"
            value={publishedTotal === null ? '…' : `${publishedTotal}`}
            tone="muted"
          />
          <Stat
            icon={<Clock className="w-3.5 h-3.5" />}
            label="Last run"
            value={lastRunAt ? formatRelative(lastRunAt) : 'Not run yet'}
            tone="muted"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {isRunning ? (
            <button
              onClick={stopRun}
              disabled={stopping}
              className="text-sm px-3 py-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 inline-flex items-center gap-2 transition disabled:opacity-50"
              title="Stop after the current item finishes"
            >
              {stopping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4 fill-current" />}
              <span className="hidden sm:inline">{stopping ? 'Stopping…' : 'Stop'}</span>
            </button>
          ) : project.enabled ? (
            <>
              <button
                onClick={runNow}
                disabled={triggering}
                className={`text-sm px-3 py-2 rounded-lg inline-flex items-center gap-2 transition ${
                  triggering
                    ? 'bg-blue-500/20 border border-blue-400/40 text-blue-200 cursor-wait'
                    : 'bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300'
                }`}
                title="Process the queue right now"
              >
                {triggering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                <span className="hidden sm:inline">{triggering ? 'Starting…' : 'Run now'}</span>
              </button>
              <button
                onClick={toggleEnabled}
                disabled={toggling}
                className="text-sm px-2.5 py-2 rounded-lg border border-white/10 hover:border-white/30 hover:bg-white/[0.04] text-white/70 hover:text-white inline-flex items-center gap-2 transition disabled:opacity-50"
                title="Pause auto-checking — the project will stop watching the sheet until you resume"
              >
                {toggling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />}
                <span className="hidden lg:inline">Pause</span>
              </button>
            </>
          ) : (
            <button
              onClick={toggleEnabled}
              disabled={toggling}
              className="text-sm px-3 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 inline-flex items-center gap-2 transition disabled:opacity-50"
              title="Resume auto-checking the Google Sheet"
            >
              {toggling ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
              <span className="hidden sm:inline">Resume</span>
            </button>
          )}
          <ChevronRight className="w-4 h-4 text-white/30 group-hover:text-white/70 transition" />
        </div>
      </div>

      {/* Mobile stats row */}
      <div className="md:hidden px-5 pb-3 -mt-1 flex items-center gap-4 text-xs text-white/50">
        <span>{queueCount === null ? '…' : queueCount === 0 ? 'Up to date' : `${queueCount} waiting`}</span>
        <span>·</span>
        <span>{publishedTotal ?? 0} published</span>
        <span>·</span>
        <span>{lastRunAt ? formatRelative(lastRunAt) : 'Not run yet'}</span>
      </div>
    </Link>
  );
}

function StatusBadge({ status }: { status: Status }) {
  if (status === 'running') {
    return (
      <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-200 border border-blue-400/30 inline-flex items-center gap-1.5">
        <Loader2 className="w-3 h-3 animate-spin" /> Working
      </span>
    );
  }
  if (status === 'watching') {
    return (
      <span
        className="text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 inline-flex items-center gap-1.5"
        title="Auto-checks the Google Sheet for new content"
      >
        <span className="relative flex w-2 h-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
        </span>
        Watching
      </span>
    );
  }
  return (
    <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-white/5 text-white/40 border border-white/10 inline-flex items-center gap-1.5">
      <Pause className="w-3 h-3" /> Paused
    </span>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'muted' | 'amber';
}) {
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-wider text-white/35 inline-flex items-center gap-1 justify-end">
        {icon}
        {label}
      </div>
      <div className={`text-sm font-medium mt-0.5 ${tone === 'amber' ? 'text-amber-300' : 'text-white/85'}`}>
        {value}
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
