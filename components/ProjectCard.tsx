// components/ProjectCard.tsx
'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Play, RefreshCw, CheckCircle2, AlertCircle, Loader2, ExternalLink,
  Pencil, FileText, Clock, RotateCcw, AlertTriangle, LogIn, LogOut,
  Inbox, Radio, Sparkles, Pause, PlayCircle, Square, Search, X, Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

const PHASE_LABELS: Record<string, string> = {
  idle: 'Idle',
  polling: 'Checking sheet for new rows',
  extracting: 'Pulling content from source',
  publishing: 'Creating WordPress draft',
  writeback: 'Updating sheet status',
  done: 'Finishing up',
};

const PHASE_PROGRESS: Record<string, number> = {
  idle: 5,
  polling: 15,
  extracting: 40,
  publishing: 75,
  writeback: 92,
  done: 100,
};

interface PublicProject {
  id: string;
  name: string;
  enabled: boolean;
  wordpress: { baseUrl: string; username?: string };
  sheet: {
    sheetId: string;
    tabName: string;
    columns: { status: string; pageType: string; primaryKeyword: string; contentLink: string };
    triggerValue: string;
    completedValue: string;
  };
  pageTypeRouting: Record<string, 'post' | 'page'>;
  publishStatus: string;
}

interface QueueItem {
  projectId: string; rowIndex: number; status: string;
  pageType: string; primaryKeyword: string; contentLink: string;
}

interface PublishedItem {
  projectId: string; rowIndex: number; wpId: number;
  wpLink: string; editLink: string; sourceLink: string;
  processedAt: string; title: string; pageType: string;
  route: 'post' | 'page'; primaryKeyword: string;
  status: 'success' | 'partial';
  currentStatus?: 'draft' | 'publish' | 'pending' | 'private' | 'future' | 'trash' | 'unknown';
}

interface RunSummary {
  lastRunAt: string | null;
  recentSuccessCount: number;
  totalPublished: number;
}

interface HealthReport {
  sheet?: { ok: boolean; rowCount?: number; error?: string };
  wp?: { ok: boolean; username?: string; error?: string };
  error?: string;
}

interface LiveState {
  running: boolean;
  projectId: string | null;
  rowIndex: number | null;
  phase: 'idle' | 'polling' | 'extracting' | 'publishing' | 'writeback' | 'done';
  message: string;
}

type Tab = 'queue' | 'drafts' | 'published';

interface WpPublishedRow {
  id: number;
  type: 'post' | 'page';
  title: string;
  metaTitle: string;
  metaDescription: string;
  keyword: string;
  link: string;
  editLink: string;
  date: string;
  modified: string;
}

export default function ProjectCard({ project: initialProject }: { project: PublicProject }) {
  const router = useRouter();
  const [project, setProject] = useState<PublicProject>(initialProject);
  const [tab, setTab] = useState<Tab>('queue');
  const [toggling, setToggling] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [published, setPublished] = useState<PublishedItem[] | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [surferSession, setSurferSession] = useState<{ loggedIn: boolean; detail: string } | null>(null);
  const [surferLoading, setSurferLoading] = useState(false);
  const [connector, setConnector] = useState<{
    surfer: { connected: boolean; ageSeconds?: number; localStorageKeys?: number };
    frase: { connected: boolean; ageSeconds?: number; localStorageKeys?: number };
  } | null>(null);
  const [wpPublished, setWpPublished] = useState<WpPublishedRow[] | null>(null);
  const [wpPublishedError, setWpPublishedError] = useState<string | null>(null);
  const [wpPublishedLoading, setWpPublishedLoading] = useState(false);

  const amCurrentProject = live?.running && live.projectId === project.id;
  const hasSurferLinks = useMemo(
    () => (queue || []).some((r) => /app\.surferseo\.com|surferseo\.com/i.test(r.contentLink)),
    [queue]
  );

  async function refresh() {
    setLoading(true);
    setMessage(null);
    try {
      const [q, h, p] = await Promise.all([
        fetch(`/api/queue?projectId=${project.id}`).then((r) => r.json()),
        fetch(`/api/projects/${project.id}/health`).then((r) => r.json()),
        fetch(`/api/projects/${project.id}/published?limit=100`).then((r) => r.json()),
      ]);
      setQueue(q.queue || []);
      setHealth(h);
      setPublished(p.published || []);
      setSummary(p.summary || null);
    } catch (e) {
      setMessage(`Failed to load: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function refreshLive() {
    try {
      const res = await fetch('/api/worker/status').then((r) => r.json());
      setLive(res);
    } catch {}
  }

  async function refreshSurferSession() {
    try {
      const res = await fetch(`/api/projects/${project.id}/surfer/session`).then((r) => r.json());
      setSurferSession({ loggedIn: !!res.loggedIn, detail: res.detail || '' });
    } catch (e) {
      setSurferSession({ loggedIn: false, detail: (e as Error).message });
    }
  }

  async function refreshWpPublished() {
    setWpPublishedLoading(true);
    setWpPublishedError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/wp-published?limit=50`).then((r) => r.json());
      if (res.error) {
        setWpPublishedError(res.error);
        setWpPublished([]);
      } else {
        setWpPublished(res.items || []);
      }
    } catch (e) {
      setWpPublishedError((e as Error).message);
      setWpPublished([]);
    } finally {
      setWpPublishedLoading(false);
    }
  }

  async function refreshConnector() {
    try {
      const res = await fetch(`/api/projects/${project.id}/connector`).then((r) => r.json());
      setConnector({
        surfer: res.surfer || { connected: false },
        frase: res.frase || { connected: false },
      });
    } catch {
      setConnector({ surfer: { connected: false }, frase: { connected: false } });
    }
  }

  async function disconnectSource(source: 'surfer' | 'frase') {
    if (!confirm(`Remove the saved ${source === 'surfer' ? 'Surfer' : 'Frase'} login from this project? Future runs will fail until you re-connect via the extension.`)) return;
    await fetch(`/api/projects/${project.id}/connector?source=${source}`, { method: 'DELETE' });
    await refreshConnector();
  }

  async function openSurferLogin() {
    setSurferLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/surfer/login`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setMessage(
        'A Chromium window just opened on your Mac. Log in to Surfer, then close the window. Click "Check session" when done.'
      );
    } catch (e) {
      setMessage(`Login failed: ${(e as Error).message}`);
    } finally {
      setSurferLoading(false);
    }
  }

  async function clearSurferSession() {
    if (!confirm('Clear the saved Surfer login for this project?')) return;
    await fetch(`/api/projects/${project.id}/surfer/session`, { method: 'DELETE' });
    await refreshSurferSession();
  }

  async function runNow() {
    setTriggering(true);
    setMessage(null);
    try {
      const res = await fetch('/api/worker/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      });
      const data = await res.json();
      setMessage(data.ok ? `Run complete.` : `Error: ${data.error}`);
      await refresh();
    } catch (e) {
      setMessage(`Run failed: ${(e as Error).message}`);
    } finally {
      setTriggering(false);
    }
  }

  async function toggleEnabled() {
    if (toggling) return;
    setToggling(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/toggle`, { method: 'POST' });
      const data = await res.json();
      if (data.ok && data.project) {
        setProject(data.project);
        setMessage(data.project.enabled ? 'Project resumed — watching for new content.' : 'Project paused — auto-check disabled.');
      }
    } finally {
      setToggling(false);
    }
  }

  async function stopRun() {
    if (stopping) return;
    if (!confirm('Stop after the current item finishes?\n\nWork already in flight will complete, but no further rows will be processed.')) return;
    setStopping(true);
    setMessage('Stop requested — will halt after the current row completes.');
    try {
      await fetch('/api/worker/stop', { method: 'POST' });
    } finally {
      setStopping(false);
    }
  }

  async function deleteProject() {
    if (deleting) return;
    const confirmed = confirm(
      `Delete project "${project.name}"?\n\n` +
      `This removes:\n` +
      `  • The project configuration\n` +
      `  • Local draft history (the "Drafts" tab)\n` +
      `  • Saved Surfer/Frase cookies for this project\n` +
      `  • Project logs\n\n` +
      `Posts and pages already in WordPress are NOT deleted — they stay live.\n\n` +
      `This cannot be undone.`
    );
    if (!confirmed) return;
    setDeleting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.ok) {
        setMessage(`Delete failed: ${data.error || 'unknown error'}`);
        setDeleting(false);
        return;
      }
      router.push('/wp-publisher');
      router.refresh();
    } catch (e) {
      setMessage(`Delete failed: ${(e as Error).message}`);
      setDeleting(false);
    }
  }

  async function resetHistory() {
    if (!confirm(
      'Clear published history for this project?\n\n' +
      'This removes the local record of what has been published, but keeps everything that\'s already in WordPress. ' +
      'The next run will re-check all rows (including ones you\'ve already published).'
    )) return;
    await fetch(`/api/projects/${project.id}/published`, { method: 'DELETE' });
    await refresh();
  }

  useEffect(() => {
    refresh();
    refreshLive();
    refreshSurferSession();
    refreshConnector();
    const t = setInterval(refresh, 30000);
    const lt = setInterval(refreshLive, 2000); // live ticks fast
    const ct = setInterval(refreshConnector, 30000);
    return () => { clearInterval(t); clearInterval(lt); clearInterval(ct); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lazy-fetch the WP "Published" list only when the tab is opened.
  useEffect(() => {
    if (tab === 'published' && wpPublished === null && !wpPublishedLoading) {
      refreshWpPublished();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const sheetOk = health?.sheet?.ok;
  const wpOk = health?.wp?.ok;
  const lastRunText = useMemo(() => {
    if (!summary?.lastRunAt) return 'Never';
    return formatRelative(summary.lastRunAt);
  }, [summary?.lastRunAt]);

  const isBusy = amCurrentProject || triggering;
  const livePhaseLabel = live?.phase ? PHASE_LABELS[live.phase] || live.phase : '';

  return (
    <div
      className={`relative rounded-xl border bg-white/[0.02] overflow-hidden transition ${
        isBusy
          ? 'border-blue-500/40 shadow-[0_0_0_1px_rgba(59,130,246,0.25),0_0_30px_rgba(59,130,246,0.15)]'
          : 'border-white/10'
      }`}
    >
      {/* Active running ribbon */}
      {isBusy && (
        <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden">
          <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-blue-400 to-transparent animate-[shimmer_1.6s_linear_infinite]" />
        </div>
      )}

      {/* Header */}
      <div className="px-6 py-5 border-b border-white/10 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-xl font-semibold">{project.name}</h2>
            {isBusy ? (
              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-200 border border-blue-400/30 inline-flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                {triggering && !amCurrentProject ? 'Starting…' : 'Running now'}
              </span>
            ) : project.enabled ? (
              <span
                className="text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 inline-flex items-center gap-1.5"
                title="Auto-polls the Google Sheet at the configured interval"
              >
                <span className="relative flex w-2 h-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                </span>
                Watching
              </span>
            ) : (
              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-white/5 text-white/40 border border-white/10">
                Paused
              </span>
            )}
          </div>
          <div className="text-sm text-white/50 mt-1.5">
            {project.wordpress.baseUrl} · saves as <code className="text-white/70">{project.publishStatus}</code>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/wp-publisher/edit/${project.id}`}
            className="text-sm px-3 py-2 rounded-lg border border-white/10 hover:border-white/30 hover:bg-white/[0.03] inline-flex items-center gap-2 transition"
            title="Edit project settings"
          >
            <Pencil className="w-4 h-4" /> Edit
          </Link>
          <button
            onClick={deleteProject}
            disabled={deleting || amCurrentProject}
            className="text-sm px-3 py-2 rounded-lg border border-red-500/20 hover:border-red-500/50 hover:bg-red-500/5 text-red-300/80 hover:text-red-300 inline-flex items-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed"
            title={
              amCurrentProject
                ? 'Stop the current run before deleting'
                : 'Delete this project (posts in WordPress are not removed)'
            }
          >
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Delete
          </button>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-sm px-3 py-2 rounded-lg border border-white/10 hover:border-white/30 hover:bg-white/[0.03] inline-flex items-center gap-2 transition disabled:opacity-50"
            title="Re-fetch queue, published list, and health"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
          {amCurrentProject ? (
            <button
              onClick={stopRun}
              disabled={stopping}
              className="text-sm px-3 py-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 inline-flex items-center gap-2 transition disabled:opacity-50"
              title="Stop after the current item finishes"
            >
              {stopping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4 fill-current" />}
              {stopping ? 'Stopping…' : 'Stop'}
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
                {triggering ? 'Starting…' : 'Run now'}
              </button>
              <button
                onClick={toggleEnabled}
                disabled={toggling}
                className="text-sm px-3 py-2 rounded-lg border border-white/10 hover:border-white/30 hover:bg-white/[0.04] inline-flex items-center gap-2 transition disabled:opacity-50"
                title="Pause auto-checking — the project will stop watching the sheet until you resume"
              >
                {toggling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />}
                Pause
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
              Resume watching
            </button>
          )}
        </div>
      </div>

      {/* Health */}
      <div className="px-6 py-3 border-b border-white/10 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <HealthPill
          label="Google Sheet"
          ok={sheetOk}
          detail={
            sheetOk
              ? `${health?.sheet?.rowCount ?? 0} rows · "${project.sheet.tabName}"`
              : health?.sheet?.error || 'checking...'
          }
        />
        <HealthPill
          label="WordPress"
          ok={wpOk}
          detail={
            wpOk
              ? `Authenticated as ${health?.wp?.username ?? 'user'}`
              : health?.wp?.error || 'checking...'
          }
        />
        <div className="flex items-start gap-2">
          <Clock className="w-4 h-4 text-white/40 mt-0.5 shrink-0" />
          <div>
            <div className="text-white/80">Last publish</div>
            <div className="text-xs text-white/50">
              {lastRunText} · <span className="text-emerald-400">{summary?.totalPublished ?? 0}</span> total
            </div>
          </div>
        </div>
      </div>

      {/* Connector status — Surfer / Frase auth via browser extension */}
      <div className="px-6 py-4 border-b border-white/10 bg-white/[0.01]">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-sm text-white/85 font-medium">Content sources</div>
            <div className="text-xs text-white/45 mt-0.5">
              Connect Surfer and Frase via the browser extension to let this project read articles you've drafted there.
            </div>
          </div>
          <details className="text-xs text-white/55 whitespace-nowrap">
            <summary className="cursor-pointer hover:text-white/80 select-none">How to connect</summary>
            <div className="mt-2 max-w-xs whitespace-normal text-white/55 leading-relaxed">
              <ol className="list-decimal pl-4 space-y-1">
                <li>Install the WP Publisher Connector extension (one time):
                  <code className="block mt-1 text-white/40">chrome://extensions → Developer mode → Load unpacked → select <span className="text-white/70">/extension</span></code>
                </li>
                <li>Sign in to Surfer/Frase in this Chrome profile.</li>
                <li>Open this project page, click the extension icon, then "Connect Surfer" or "Connect Frase".</li>
              </ol>
            </div>
          </details>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ConnectorPill
            label="Surfer SEO"
            info={connector?.surfer}
            onDisconnect={() => disconnectSource('surfer')}
          />
          <ConnectorPill
            label="Frase"
            info={connector?.frase}
            onDisconnect={() => disconnectSource('frase')}
          />
        </div>
      </div>

      {/* Live status strip (only shown while this project is running) */}
      {amCurrentProject && live && (
        <div className="px-6 py-4 border-b border-white/10 bg-blue-500/[0.06]">
          <div className="flex items-center gap-3 text-sm">
            <Sparkles className="w-4 h-4 text-blue-300 animate-pulse" />
            <span className="text-blue-100 font-medium">
              {PHASE_LABELS[live.phase] || live.phase}
            </span>
            {live.rowIndex && (
              <span className="text-xs px-2 py-0.5 rounded bg-blue-500/15 text-blue-200 border border-blue-400/20">
                Row {live.rowIndex}
              </span>
            )}
            <span className="text-white/60 truncate">{live.message}</span>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-400 via-blue-300 to-emerald-300 transition-[width] duration-700 ease-out"
              style={{ width: `${PHASE_PROGRESS[live.phase] ?? 10}%` }}
            />
          </div>
        </div>
      )}

      {message && (
        <div className="px-6 py-3 border-b border-white/10 text-sm text-white/70 bg-white/[0.02]">{message}</div>
      )}

      {/* Tabs */}
      <div className="px-6 pt-4 flex gap-1 border-b border-white/10 -mb-px items-center">
        <TabButton active={tab === 'queue'} onClick={() => setTab('queue')}>
          Queue {queue && queue.length > 0 ? `(${queue.length})` : ''}
        </TabButton>
        <TabButton active={tab === 'drafts'} onClick={() => setTab('drafts')}>
          Drafts {(() => {
            if (!published) return '';
            const drafts = published.filter((p) => p.currentStatus === 'draft');
            return drafts.length > 0 ? `(${drafts.length})` : '';
          })()}
        </TabButton>
        <TabButton active={tab === 'published'} onClick={() => setTab('published')}>
          Published {wpPublished && wpPublished.length > 0 ? `(${wpPublished.length})` : ''}
        </TabButton>
        {tab === 'drafts' && published && published.length > 0 && (
          <button
            onClick={resetHistory}
            className="ml-auto text-xs text-white/40 hover:text-white/70 inline-flex items-center gap-1 mb-2"
            title="Clear local draft history (does not delete drafts in WordPress)"
          >
            <RotateCcw className="w-3 h-3" /> Reset history
          </button>
        )}
        {tab === 'published' && (
          <button
            onClick={refreshWpPublished}
            disabled={wpPublishedLoading}
            className="ml-auto text-xs text-white/40 hover:text-white/70 inline-flex items-center gap-1 mb-2"
            title="Re-fetch from WordPress"
          >
            {wpPublishedLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Refresh
          </button>
        )}
      </div>

      {/* Tab content */}
      <div className="px-6 py-4">
        {tab === 'queue' && <QueueTable queue={queue} project={project} liveRow={amCurrentProject ? live?.rowIndex ?? null : null} livePhase={amCurrentProject ? live?.phase ?? null : null} />}
        {tab === 'drafts' && <DraftsTable published={published} />}
        {tab === 'published' && (
          <WpPublishedTable items={wpPublished} loading={wpPublishedLoading} error={wpPublishedError} />
        )}
      </div>
    </div>
  );
}

/* ---------------- subcomponents ---------------- */

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-sm px-4 py-2 border-b-2 transition ${
        active
          ? 'border-emerald-400 text-white'
          : 'border-transparent text-white/50 hover:text-white/80'
      }`}
    >
      {children}
    </button>
  );
}

function QueueTable({
  queue, project, liveRow, livePhase,
}: {
  queue: QueueItem[] | null;
  project: PublicProject;
  liveRow: number | null;
  livePhase: string | null;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    if (!queue) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return queue;
    return queue.filter((row) =>
      String(row.rowIndex).includes(needle) ||
      (row.pageType || '').toLowerCase().includes(needle) ||
      (row.primaryKeyword || '').toLowerCase().includes(needle) ||
      (row.contentLink || '').toLowerCase().includes(needle)
    );
  }, [queue, q]);

  if (queue === null) {
    return (
      <div className="text-white/40 text-sm py-8 text-center inline-flex items-center justify-center gap-2 w-full">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading queue…
      </div>
    );
  }
  if (queue.length === 0) {
    return (
      <div className="py-10 text-center">
        <Inbox className="w-8 h-8 text-white/20 mx-auto mb-3" />
        <div className="text-white/70 text-sm font-medium">Queue is empty</div>
        <div className="text-white/40 text-xs mt-1">
          We'll pick up new rows automatically when their <span className="text-emerald-300">Status</span> column says
          {' '}<code className="text-white/60">"{project.sheet.triggerValue}"</code>.
        </div>
      </div>
    );
  }
  return (
    <div>
      <TableSearch
        value={q}
        onChange={setQ}
        placeholder="Search by keyword, page type, row #, or doc URL…"
        resultLabel={filtered && q ? `${filtered.length} of ${queue.length}` : undefined}
      />
      {filtered && filtered.length === 0 ? (
        <div className="text-white/40 text-xs py-6 text-center">No queue items match "{q}".</div>
      ) : (
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-white/40 border-b border-white/10">
          <tr>
            <th className="py-2 pr-3 w-14">Row</th>
            <th className="py-2 pr-3 w-24">Status</th>
            <th className="py-2 pr-3">Page Type → Route</th>
            <th className="py-2 pr-3">Primary Keyword</th>
            <th className="py-2 pr-3 w-20">Doc</th>
          </tr>
        </thead>
        <tbody>
          {(filtered || []).map((row) => {
            const route = project.pageTypeRouting[row.pageType.toLowerCase()] || 'page';
            const isLive = liveRow === row.rowIndex;
            return (
              <tr key={row.rowIndex} className={`border-b border-white/5 last:border-0 ${isLive ? 'bg-blue-500/5' : ''}`}>
                <td className="py-2 pr-3 text-white/50">{row.rowIndex}</td>
                <td className="py-2 pr-3">
                  {isLive && livePhase ? (
                    <span className="text-xs text-blue-300 inline-flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> {livePhase}
                    </span>
                  ) : (
                    <span className="text-xs text-white/40">waiting</span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <span className="text-white/80">{row.pageType || '(empty)'}</span>
                  <span className="text-white/40"> → </span>
                  <code className="text-xs text-white/60">{route}</code>
                </td>
                <td className="py-2 pr-3 text-white/80">{row.primaryKeyword || '—'}</td>
                <td className="py-2 pr-3">
                  {row.contentLink && /^https?:\/\//i.test(row.contentLink) ? (
                    <a
                      href={row.contentLink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 text-xs"
                    >
                      open <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <span className="text-amber-400/70 text-xs" title="Cell has no valid URL">
                      {row.contentLink ? `"${row.contentLink}"` : 'missing'}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
      )}
    </div>
  );
}

function DraftsTable({ published }: { published: PublishedItem[] | null }) {
  const [q, setQ] = useState('');

  // Strict: only show items whose current WordPress status is "draft".
  // Anything else (publish, pending, private, future, trash, deleted/unknown)
  // is hidden — those rows belong on the Published tab or have been removed
  // from WP altogether.
  const drafts = useMemo(() => {
    if (!published) return null;
    return published.filter((p) => p.currentStatus === 'draft');
  }, [published]);
  const movedOutCount = useMemo(() => {
    if (!published) return 0;
    return published.filter(
      (p) =>
        p.currentStatus &&
        p.currentStatus !== 'draft' &&
        p.currentStatus !== 'unknown'
    ).length;
  }, [published]);
  const goneCount = useMemo(() => {
    if (!published) return 0;
    return published.filter(
      (p) => p.currentStatus === 'unknown' || p.currentStatus === 'trash'
    ).length;
  }, [published]);

  const filtered = useMemo(() => {
    if (!drafts) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return drafts;
    return drafts.filter((p) =>
      (p.title || '').toLowerCase().includes(needle) ||
      (p.primaryKeyword || '').toLowerCase().includes(needle) ||
      (p.pageType || '').toLowerCase().includes(needle) ||
      (p.route || '').toLowerCase().includes(needle) ||
      String(p.rowIndex).includes(needle)
    );
  }, [drafts, q]);

  if (published === null) {
    return (
      <div className="text-white/40 text-sm py-8 text-center inline-flex items-center justify-center gap-2 w-full">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading drafts…
      </div>
    );
  }
  if (drafts && drafts.length === 0 && movedOutCount > 0) {
    return (
      <div className="py-10 text-center">
        <CheckCircle2 className="w-8 h-8 text-emerald-400/70 mx-auto mb-3" />
        <div className="text-white/70 text-sm font-medium">All drafts have been published</div>
        <div className="text-white/40 text-xs mt-1">
          {movedOutCount} {movedOutCount === 1 ? 'item is' : 'items are'} live in WordPress now — see the <span className="text-emerald-300">Published</span> tab.
        </div>
      </div>
    );
  }
  if (published.length === 0) {
    return (
      <div className="py-10 text-center">
        <FileText className="w-8 h-8 text-white/20 mx-auto mb-3" />
        <div className="text-white/70 text-sm font-medium">No drafts created yet</div>
        <div className="text-white/40 text-xs mt-1">
          Hit <span className="text-emerald-300">Run now</span> to process the queue. Drafts created here will appear in WordPress under <span className="text-white/70">Drafts</span>.
        </div>
      </div>
    );
  }
  return (
    <div>
      <TableSearch
        value={q}
        onChange={setQ}
        placeholder="Search drafts by title, keyword, page type, or row #…"
        resultLabel={filtered && q && drafts ? `${filtered.length} of ${drafts.length}` : undefined}
      />
      {(movedOutCount > 0 || goneCount > 0) && (
        <div className="text-xs text-white/45 mb-3 flex flex-col gap-1">
          {movedOutCount > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-emerald-400/80" />
              {movedOutCount} {movedOutCount === 1 ? 'item is' : 'items are'} now in a non-draft status in WordPress — see the <span className="text-emerald-300">Published</span> tab.
            </span>
          )}
          {goneCount > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3 text-amber-400/80" />
              {goneCount} {goneCount === 1 ? 'item was' : 'items were'} removed in WordPress (trashed or deleted). They'll be re-published on the next run.
            </span>
          )}
        </div>
      )}
      {filtered && filtered.length === 0 ? (
        <div className="text-white/40 text-xs py-6 text-center">No drafts match "{q}".</div>
      ) : (
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-white/40 border-b border-white/10">
          <tr>
            <th className="py-2 pr-3 w-40">When</th>
            <th className="py-2 pr-3 w-14">Row</th>
            <th className="py-2 pr-3 w-20">Route</th>
            <th className="py-2 pr-3">Title</th>
            <th className="py-2 pr-3 w-48">Actions</th>
          </tr>
        </thead>
        <tbody>
          {(filtered || []).map((p) => (
            <tr key={`${p.rowIndex}-${p.wpId}`} className="border-b border-white/5 last:border-0">
              <td className="py-2 pr-3 text-white/50 text-xs whitespace-nowrap">
                {formatRelative(p.processedAt)}
              </td>
              <td className="py-2 pr-3 text-white/50">{p.rowIndex}</td>
              <td className="py-2 pr-3">
                <code className="text-xs text-white/60">{p.route}</code>
                {p.status === 'partial' && (
                  <span className="ml-2 text-amber-400" title="WP created but sheet writeback failed">
                    <AlertTriangle className="w-3 h-3 inline" />
                  </span>
                )}
              </td>
              <td className="py-2 pr-3">
                <div className="text-white/90 line-clamp-1">{p.title}</div>
                {p.primaryKeyword && p.primaryKeyword !== p.title && (
                  <div className="text-xs text-white/40">{p.primaryKeyword}</div>
                )}
              </td>
              <td className="py-2 pr-3">
                <div className="flex gap-3 text-xs">
                  <a
                    href={p.editLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1"
                    title="Open in WP admin"
                  >
                    <Pencil className="w-3 h-3" /> Edit in WP
                  </a>
                  <a
                    href={p.wpLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
                    title="View public URL (may be draft-only)"
                  >
                    <FileText className="w-3 h-3" /> View
                  </a>
                  <a
                    href={p.sourceLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-white/50 hover:text-white/80 inline-flex items-center gap-1"
                    title="Open source doc"
                  >
                    <ExternalLink className="w-3 h-3" /> Source
                  </a>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
      )}
    </div>
  );
}

function WpPublishedTable({
  items,
  loading,
  error,
}: {
  items: WpPublishedRow[] | null;
  loading: boolean;
  error: string | null;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    if (!items) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) =>
      (it.title || '').toLowerCase().includes(needle) ||
      (it.metaTitle || '').toLowerCase().includes(needle) ||
      (it.metaDescription || '').toLowerCase().includes(needle) ||
      (it.keyword || '').toLowerCase().includes(needle) ||
      (it.type || '').toLowerCase().includes(needle) ||
      (it.link || '').toLowerCase().includes(needle)
    );
  }, [items, q]);

  if (loading && items === null) {
    return (
      <div className="text-white/40 text-sm py-8 text-center inline-flex items-center justify-center gap-2 w-full">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading published posts from WordPress…
      </div>
    );
  }
  if (error) {
    return (
      <div className="py-8 text-center">
        <AlertCircle className="w-8 h-8 text-red-400/70 mx-auto mb-3" />
        <div className="text-red-300 text-sm font-medium">Couldn't load from WordPress</div>
        <div className="text-white/45 text-xs mt-1 max-w-md mx-auto break-words">{error}</div>
      </div>
    );
  }
  if (!items || items.length === 0) {
    return (
      <div className="py-10 text-center">
        <FileText className="w-8 h-8 text-white/20 mx-auto mb-3" />
        <div className="text-white/70 text-sm font-medium">Nothing published on WordPress yet</div>
        <div className="text-white/40 text-xs mt-1">
          Drafts created by this app appear here once someone hits <span className="text-white/70">Publish</span> on them in WordPress.
        </div>
      </div>
    );
  }
  return (
    <div>
      <TableSearch
        value={q}
        onChange={setQ}
        placeholder="Search title, meta title, meta description, keyword, type, or URL…"
        resultLabel={filtered && q ? `${filtered.length} of ${items.length}` : undefined}
      />
      {filtered && filtered.length === 0 ? (
        <div className="text-white/40 text-xs py-6 text-center">No published items match "{q}".</div>
      ) : (
      <div className="overflow-x-auto">
      <table className="w-full text-sm table-fixed">
        <thead className="text-left text-white/40 border-b border-white/10">
          <tr>
            <th className="py-2 pr-3 w-28">Last modified</th>
            <th className="py-2 pr-3 w-16">Type</th>
            <th className="py-2 pr-3 w-[18%]">Title</th>
            <th className="py-2 pr-3 w-[18%]">SEO Title</th>
            <th className="py-2 pr-3">Meta Description</th>
            <th className="py-2 pr-3 w-[16%]">Keyword</th>
            <th className="py-2 pr-3 w-32">Actions</th>
          </tr>
        </thead>
        <tbody>
          {(filtered || []).map((it) => (
            <tr key={`${it.type}-${it.id}`} className="border-b border-white/5 last:border-0 align-top">
              <td className="py-2 pr-3 text-white/50 text-xs whitespace-nowrap">
                {formatRelative(it.modified)}
              </td>
              <td className="py-2 pr-3">
                <code className="text-xs text-white/60">{it.type}</code>
              </td>
              <td className="py-2 pr-3">
                <div className="text-white/90 line-clamp-2 break-words" title={it.title}>
                  {it.title || '(untitled)'}
                </div>
              </td>
              <td className="py-2 pr-3">
                {it.metaTitle ? (
                  <div className="text-white/75 text-xs line-clamp-2 break-words" title={it.metaTitle}>
                    {it.metaTitle}
                  </div>
                ) : (
                  <span className="text-white/25 text-xs">—</span>
                )}
              </td>
              <td className="py-2 pr-3">
                {it.metaDescription ? (
                  <div className="text-white/60 text-xs line-clamp-3 break-words" title={it.metaDescription}>
                    {it.metaDescription}
                  </div>
                ) : (
                  <span className="text-white/25 text-xs">—</span>
                )}
              </td>
              <td className="py-2 pr-3 text-xs">
                {it.keyword ? (
                  <span className="text-emerald-300/90 line-clamp-2 break-words" title={it.keyword}>
                    {it.keyword}
                  </span>
                ) : (
                  <span className="text-white/25" title="Install the WP Publisher Yoast plugin on the WP site to expose focus keyphrases for all posts.">—</span>
                )}
              </td>
              <td className="py-2 pr-3">
                <div className="flex gap-3 text-xs flex-wrap">
                  <a
                    href={it.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
                    title="View public URL"
                  >
                    <ExternalLink className="w-3 h-3" /> View
                  </a>
                  <a
                    href={it.editLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1"
                    title="Open in WordPress admin"
                  >
                    <Pencil className="w-3 h-3" /> Edit
                  </a>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
      )}
    </div>
  );
}

function ConnectorPill({
  label,
  info,
  onDisconnect,
}: {
  label: string;
  info?: { connected: boolean; ageSeconds?: number; localStorageKeys?: number };
  onDisconnect: () => void;
}) {
  const ageMin = info?.ageSeconds ? Math.floor(info.ageSeconds / 60) : 0;
  const lsKeys = info?.localStorageKeys ?? 0;
  const baseText = !info?.connected
    ? 'Not connected'
    : ageMin < 1
    ? 'Connected · just refreshed'
    : ageMin < 60
    ? `Connected · refreshed ${ageMin}m ago`
    : `Connected · refreshed ${Math.floor(ageMin / 60)}h ago`;
  const ageText = info?.connected
    ? `${baseText} · ${lsKeys} localStorage ${lsKeys === 1 ? 'key' : 'keys'}`
    : baseText;

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 flex items-center gap-3 ${
        info?.connected
          ? 'border-emerald-500/25 bg-emerald-500/[0.04]'
          : 'border-white/10 bg-white/[0.02]'
      }`}
    >
      {info === undefined ? (
        <Loader2 className="w-4 h-4 animate-spin text-white/40" />
      ) : info.connected ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
      ) : (
        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white/90">{label}</div>
        <div className={`text-xs ${info?.connected ? 'text-emerald-400/80' : 'text-white/45'}`}>
          {ageText}
        </div>
      </div>
      {info?.connected && (
        <button
          onClick={onDisconnect}
          className="text-xs px-2 py-1 rounded border border-white/10 hover:border-red-500/40 hover:text-red-300 text-white/55 transition"
          title={`Remove the saved ${label} cookies for this project`}
        >
          Disconnect
        </button>
      )}
    </div>
  );
}

function HealthPill({ label, ok, detail }: { label: string; ok?: boolean; detail: string }) {
  return (
    <div className="flex items-start gap-2">
      {ok === undefined ? (
        <Loader2 className="w-4 h-4 animate-spin text-white/40 mt-0.5" />
      ) : ok ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
      ) : (
        <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
      )}
      <div>
        <div className="text-white/80">{label}</div>
        <div className={`text-xs ${ok === false ? 'text-red-400/80' : 'text-white/50'}`}>{detail}</div>
      </div>
    </div>
  );
}

function TableSearch({
  value,
  onChange,
  placeholder,
  resultLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  resultLabel?: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <div className="relative flex-1 max-w-md">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-white/[0.03] border border-white/10 rounded-lg pl-8 pr-8 py-1.5 text-xs placeholder:text-white/30 focus:border-white/30 focus:outline-none focus:bg-white/[0.05]"
        />
        {value && (
          <button
            onClick={() => onChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-white/10"
            aria-label="Clear search"
          >
            <X className="w-3 h-3 text-white/50" />
          </button>
        )}
      </div>
      {value && resultLabel && (
        <span className="text-xs text-white/40">{resultLabel}</span>
      )}
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
