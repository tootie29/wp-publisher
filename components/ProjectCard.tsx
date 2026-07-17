// components/ProjectCard.tsx
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Play, RefreshCw, CheckCircle2, AlertCircle, Loader2, ExternalLink,
  Pencil, FileText, Clock, RotateCcw, AlertTriangle, LogIn, LogOut,
  Inbox, Radio, Sparkles, Pause, PlayCircle, Square, Search, X, Trash2, Rocket, Plus,
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
    columns: {
      status: string; pageType: string; primaryKeyword: string; contentLink: string;
      categories?: string; tags?: string;
    };
    triggerValue: string;
    completedValue: string;
  };
  pageTypeRouting: Record<string, 'post' | 'page'>;
  publishStatus: string;
}

interface QueueItem {
  projectId: string; rowIndex: number; status: string;
  pageType: string; primaryKeyword: string; contentLink: string;
  categories?: string[]; tags?: string[];
}

interface RequeueRow {
  rowIndex: number; primaryKeyword: string; pageType: string;
  contentLink: string; wpLink?: string; route?: 'post' | 'page';
}

interface PublishedItem {
  projectId: string; rowIndex: number; wpId: number;
  wpLink: string; editLink: string; sourceLink: string;
  processedAt: string; title: string; pageType: string;
  route: 'post' | 'page'; primaryKeyword: string;
  status: 'success' | 'partial';
  currentStatus?: 'draft' | 'publish' | 'pending' | 'private' | 'future' | 'trash' | 'unknown';
  // Live WP fields, editable from the Drafts tab before the item goes live.
  metaTitle?: string;
  metaDescription?: string;
  keyword?: string;
  categories?: string[];
  tags?: string[];
}

/* --- Shared WP item editing (Drafts + Published tabs use the same endpoint) --- */

// Both tabs edit the same WordPress objects — a draft and a published post
// differ only in status — so the SEO/taxonomy writes go through one PATCH.
async function patchWpItem(
  projectId: string,
  id: number,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/projects/${projectId}/wp-published/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    ok?: boolean;
    error?: string;
  };
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function saveSeoField(
  projectId: string,
  id: number,
  type: 'post' | 'page',
  field: EditableField,
  next: string
): Promise<{ metaTitle?: string; metaDescription?: string; keyword?: string }> {
  const data = await patchWpItem(projectId, id, { type, [field]: next });
  return {
    metaTitle: typeof data.metaTitle === 'string' ? data.metaTitle : undefined,
    metaDescription:
      typeof data.metaDescription === 'string' ? data.metaDescription : undefined,
    keyword: typeof data.keyword === 'string' ? data.keyword : undefined,
  };
}

async function saveTermList(
  projectId: string,
  id: number,
  type: 'post' | 'page',
  taxonomy: 'categories' | 'tags',
  next: string[]
): Promise<string[]> {
  const data = await patchWpItem(projectId, id, { type, [taxonomy]: next });
  // Trust the server's echo — it carries WordPress's canonical spelling.
  const echoed = data[taxonomy];
  return Array.isArray(echoed) ? (echoed as string[]) : next;
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

// The WP site's categories/tags, plus which routes actually have taxonomies
// registered. Core gives them to posts only; the wp-publisher mu-plugin adds
// them to pages too — so this is read from the site, never assumed.
interface SiteTerms {
  categories: string[];
  tags: string[];
  supports: { post: boolean; page: boolean };
}

interface WpPublishedRow {
  id: number;
  type: 'post' | 'page';
  title: string;
  metaTitle: string;
  metaDescription: string;
  keyword: string;
  categories: string[];
  tags: string[];
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
  const [alreadyPublished, setAlreadyPublished] = useState<RequeueRow[]>([]);
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
  // Shared by the Queue chips and the Published tab's editor. Assume both routes
  // take terms until the probe says otherwise, so a slow load doesn't flash the
  // editor as disabled.
  const [terms, setTerms] = useState<SiteTerms>({
    categories: [],
    tags: [],
    supports: { post: true, page: true },
  });

  const loadTerms = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/terms`);
      const data = (await res.json()) as {
        categories?: string[];
        tags?: string[];
        supports?: { post?: boolean; page?: boolean };
        error?: string;
      };
      if (!data.error) {
        setTerms({
          categories: data.categories || [],
          tags: data.tags || [],
          supports: { post: data.supports?.post ?? true, page: data.supports?.page ?? true },
        });
      }
    } catch {
      // Autocomplete is a convenience — typing a term still works without it.
    }
  }, [project.id]);

  useEffect(() => {
    void loadTerms();
  }, [loadTerms]);

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
      setAlreadyPublished(q.alreadyPublished || []);
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
        {tab === 'queue' && <QueueTable queue={queue} alreadyPublished={alreadyPublished} projectId={project.id} onChange={refresh} project={project} termSupport={terms.supports} liveRow={amCurrentProject ? live?.rowIndex ?? null : null} livePhase={amCurrentProject ? live?.phase ?? null : null} />}
        {tab === 'drafts' && (
          <DraftsTable
            published={published}
            projectId={project.id}
            onChange={refresh}
            terms={terms}
            onTermsChanged={loadTerms}
            onItemUpdated={(updated) => {
              setPublished((curr) =>
                (curr || []).map((row) =>
                  row.rowIndex === updated.rowIndex && row.wpId === updated.wpId
                    ? { ...row, ...updated }
                    : row
                )
              );
            }}
          />
        )}
        {tab === 'published' && (
          <WpPublishedTable
            projectId={project.id}
            items={wpPublished}
            loading={wpPublishedLoading}
            error={wpPublishedError}
            terms={terms}
            onTermsChanged={loadTerms}
            onItemUpdated={(updated) => {
              setWpPublished((curr) =>
                (curr || []).map((row) =>
                  row.id === updated.id && row.type === updated.type ? { ...row, ...updated } : row
                )
              );
            }}
          />
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

// Categories/tags for one queue row. When the site doesn't register taxonomies
// for this row's route, the terms are shown struck through — they'll be ignored
// at publish time and this is the cheapest place to notice the mismatch.
function TermChips({
  categories, tags, route, ignored,
}: {
  categories?: string[];
  tags?: string[];
  route: 'post' | 'page';
  ignored: boolean;
}) {
  const cats = categories || [];
  const tgs = tags || [];
  if (!cats.length && !tgs.length) return <span className="text-white/25 text-xs">—</span>;
  return (
    <div
      className={`flex flex-wrap gap-1 ${ignored ? 'opacity-50' : ''}`}
      title={
        ignored
          ? `This site's ${route}s have no categories or tags registered, so these are ignored. Install or update the wp-publisher-yoast-rest mu-plugin to enable them.`
          : undefined
      }
    >
      {cats.map((c) => (
        <span
          key={`c-${c}`}
          className={`text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300/90 ${ignored ? 'line-through' : ''}`}
        >
          {c}
        </span>
      ))}
      {tgs.map((t) => (
        <span
          key={`t-${t}`}
          className={`text-[11px] px-1.5 py-0.5 rounded bg-white/5 text-white/60 ${ignored ? 'line-through' : ''}`}
        >
          #{t}
        </span>
      ))}
    </div>
  );
}

function QueueTable({
  queue, alreadyPublished, projectId, onChange, project, termSupport, liveRow, livePhase,
}: {
  queue: QueueItem[] | null;
  alreadyPublished: RequeueRow[];
  projectId: string;
  onChange: () => Promise<void> | void;
  project: PublicProject;
  termSupport: { post: boolean; page: boolean };
  liveRow: number | null;
  livePhase: string | null;
}) {
  const [q, setQ] = useState('');
  const [requeuing, setRequeuing] = useState<number | null>(null);

  // Only take up a column when the project actually maps taxonomy columns.
  const showTerms = Boolean(project.sheet.columns.categories || project.sheet.columns.tags);

  async function handleRequeue(rowIndex: number) {
    setRequeuing(rowIndex);
    try {
      await fetch(`/api/projects/${projectId}/published/${rowIndex}`, { method: 'DELETE' });
      await onChange();
    } catch {
      // surfaced on next refresh
    } finally {
      setRequeuing(null);
    }
  }

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
  if (queue.length === 0 && alreadyPublished.length === 0) {
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
        <div className="text-white/40 text-xs py-6 text-center">
          {q ? `No queue items match "${q}".` : 'No rows waiting to publish.'}
        </div>
      ) : (
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-white/40 border-b border-white/10">
          <tr>
            <th className="py-2 pr-3 w-14">Row</th>
            <th className="py-2 pr-3 w-24">Status</th>
            <th className="py-2 pr-3">Page Type → Route</th>
            <th className="py-2 pr-3">Primary Keyword</th>
            {showTerms && <th className="py-2 pr-3">Categories / Tags</th>}
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
                {showTerms && (
                  <td className="py-2 pr-3">
                    <TermChips
                      categories={row.categories}
                      tags={row.tags}
                      route={route}
                      ignored={!termSupport[route]}
                    />
                  </td>
                )}
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

      {alreadyPublished.length > 0 && (
        <div className="mt-5 border-t border-white/10 pt-4">
          <div className="text-xs text-white/60 mb-2">
            {alreadyPublished.length} row{alreadyPublished.length === 1 ? '' : 's'} set to{' '}
            <code className="text-white/60">"{project.sheet.triggerValue}"</code>{' '}
            {alreadyPublished.length === 1 ? 'is' : 'are'} already published, so the worker skips{' '}
            {alreadyPublished.length === 1 ? 'it' : 'them'}.{' '}
            <span className="text-amber-300/80">Re-queue</span> to reprocess (e.g. after fixing a wrong match).
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-white/40 border-b border-white/10">
                <tr>
                  <th className="py-2 pr-3 w-14">Row</th>
                  <th className="py-2 pr-3">Primary Keyword</th>
                  <th className="py-2 pr-3 w-40">Published to</th>
                  <th className="py-2 pr-3 w-28">Action</th>
                </tr>
              </thead>
              <tbody>
                {alreadyPublished.map((r) => (
                  <tr key={r.rowIndex} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-3 text-white/50">{r.rowIndex}</td>
                    <td className="py-2 pr-3 text-white/80">{r.primaryKeyword || '—'}</td>
                    <td className="py-2 pr-3">
                      {r.wpLink ? (
                        <a href={r.wpLink} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 text-xs">
                          {r.route || 'post'} <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-white/40 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <button
                        onClick={() => handleRequeue(r.rowIndex)}
                        disabled={requeuing !== null}
                        className="text-amber-300 hover:text-amber-200 inline-flex items-center gap-1 text-xs disabled:opacity-40"
                        title="Remove from publish history so it's reprocessed on the next run"
                      >
                        {requeuing === r.rowIndex ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                        Re-queue
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function DraftsTable({
  published,
  projectId,
  onChange,
  terms,
  onTermsChanged,
  onItemUpdated,
}: {
  published: PublishedItem[] | null;
  projectId: string;
  onChange: () => Promise<void> | void;
  terms: SiteTerms;
  onTermsChanged: () => void;
  onItemUpdated: (row: PublishedItem) => void;
}) {
  const [q, setQ] = useState('');

  // A draft is an ordinary WP object, so the same PATCH that edits a published
  // item edits it here — letting the team get the SEO fields and terms right
  // before anything goes live.
  async function saveField(p: PublishedItem, field: EditableField, next: string) {
    const saved = await saveSeoField(projectId, p.wpId, p.route, field, next);
    onItemUpdated({
      ...p,
      metaTitle: saved.metaTitle ?? p.metaTitle,
      metaDescription: saved.metaDescription ?? p.metaDescription,
      keyword: saved.keyword ?? p.keyword,
    });
  }

  async function saveTerms(p: PublishedItem, taxonomy: 'categories' | 'tags', next: string[]) {
    const saved = await saveTermList(projectId, p.wpId, p.route, taxonomy, next);
    onItemUpdated({ ...p, [taxonomy]: saved });
    onTermsChanged();
  }
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [pubError, setPubError] = useState<{ row: number; msg: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function toggleRow(rowIndex: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }

  // Select/deselect all currently-filtered draft rows.
  function toggleAll() {
    const rows = filtered || [];
    setSelected((prev) => {
      const allOn = rows.length > 0 && rows.every((p) => prev.has(p.rowIndex));
      const next = new Set(prev);
      if (allOn) rows.forEach((p) => next.delete(p.rowIndex));
      else rows.forEach((p) => next.add(p.rowIndex));
      return next;
    });
  }

  async function publishOne(rowIndex: number): Promise<{
    ok: boolean;
    error?: string;
    wroteToSheet?: boolean;
    column?: string;
  }> {
    const res = await fetch(`/api/projects/${projectId}/publish-draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowIndex }),
    });
    return res.json();
  }

  async function handlePublish(p: PublishedItem) {
    if (
      !confirm(`Publish "${p.title}" live on WordPress now and write its URL back to the sheet?`)
    )
      return;
    setBusy(true);
    setActiveRow(p.rowIndex);
    setPubError(null);
    setNotice(null);
    try {
      const data = await publishOne(p.rowIndex);
      if (!data.ok) throw new Error(data.error || 'Publish failed');
      setNotice(
        data.wroteToSheet
          ? `Published "${p.title}" — live URL written to column ${data.column}.`
          : `Published "${p.title}". No Published-URL or Target-URL column is mapped, so the link wasn't written to the sheet — set one in Edit project to enable that.`
      );
      await onChange();
    } catch (e) {
      setPubError({ row: p.rowIndex, msg: (e as Error).message });
    } finally {
      setBusy(false);
      setActiveRow(null);
    }
  }

  async function handleBulkPublish() {
    const rows = Array.from(selected);
    if (rows.length === 0) return;
    if (
      !confirm(
        `Publish ${rows.length} draft${rows.length === 1 ? '' : 's'} live on WordPress now and write the URLs back to the sheet?`
      )
    )
      return;
    setBusy(true);
    setPubError(null);
    setNotice(null);
    let ok = 0;
    let failed = 0;
    let noCol = 0;
    // Sequential — keeps it gentle on the WP site and gives clear per-row progress.
    for (const rowIndex of rows) {
      setActiveRow(rowIndex);
      try {
        const data = await publishOne(rowIndex);
        if (data.ok) {
          ok += 1;
          if (!data.wroteToSheet) noCol += 1;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
    setActiveRow(null);
    setSelected(new Set());
    let msg = `Published ${ok} of ${rows.length}.`;
    if (failed) msg += ` ${failed} failed.`;
    if (noCol && ok) msg += ` No URL column mapped — links weren't written to the sheet.`;
    setNotice(msg);
    await onChange();
    setBusy(false);
  }

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
      (p.metaTitle || '').toLowerCase().includes(needle) ||
      (p.metaDescription || '').toLowerCase().includes(needle) ||
      (p.keyword || '').toLowerCase().includes(needle) ||
      (p.categories || []).some((c) => c.toLowerCase().includes(needle)) ||
      (p.tags || []).some((t) => t.toLowerCase().includes(needle)) ||
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
        placeholder="Search drafts by title, SEO fields, keyword, category, tag, page type, or row #…"
        resultLabel={filtered && q && drafts ? `${filtered.length} of ${drafts.length}` : undefined}
      />
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={handleBulkPublish}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-200 inline-flex items-center gap-1.5 disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
            Publish {selected.size} selected
          </button>
          <button
            onClick={() => setSelected(new Set())}
            disabled={busy}
            className="text-xs text-white/50 hover:text-white/80 disabled:opacity-40"
          >
            Clear selection
          </button>
        </div>
      )}
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
      {notice && (
        <div className="text-xs text-emerald-300/90 bg-emerald-500/10 border border-emerald-500/20 rounded px-3 py-2 mb-3 flex items-start gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {notice}
        </div>
      )}
      {filtered && filtered.length === 0 ? (
        <div className="text-white/40 text-xs py-6 text-center">No drafts match "{q}".</div>
      ) : (
      <div className="overflow-x-auto">
      {/* Same width discipline as the Published table: table-fixed needs every
          column declared and summing to 100%, with a min-width so the wrapper
          scrolls rather than crushing cells on a narrow card. */}
      <table className="w-full text-sm table-fixed min-w-[1500px]">
        <thead className="text-left text-white/40 border-b border-white/10">
          <tr>
            <th className="py-2 pr-3 w-[3%]">
              <input
                type="checkbox"
                aria-label="Select all drafts"
                className="w-4 h-4 align-middle"
                checked={(filtered || []).length > 0 && (filtered || []).every((p) => selected.has(p.rowIndex))}
                ref={(el) => {
                  if (el) {
                    const rows = filtered || [];
                    const all = rows.length > 0 && rows.every((p) => selected.has(p.rowIndex));
                    el.indeterminate = !all && rows.some((p) => selected.has(p.rowIndex));
                  }
                }}
                onChange={toggleAll}
              />
            </th>
            <th className="py-2 pr-3 w-[6%]">When</th>
            <th className="py-2 pr-3 w-[4%]">Row</th>
            <th className="py-2 pr-3 w-[5%]">Route</th>
            <th className="py-2 pr-3 w-[13%]">Title</th>
            <th className="py-2 pr-3 w-[13%]">SEO Title</th>
            <th className="py-2 pr-3 w-[16%]">Meta Description</th>
            <th className="py-2 pr-3 w-[10%]">Keyword</th>
            <th className="py-2 pr-3 w-[11%]">Categories</th>
            <th className="py-2 pr-3 w-[11%]">Tags</th>
            <th className="py-2 pr-3 w-[8%]">Actions</th>
          </tr>
        </thead>
        <tbody>
          {(filtered || []).map((p) => (
            <tr key={`${p.rowIndex}-${p.wpId}`} className={`border-b border-white/5 last:border-0 ${selected.has(p.rowIndex) ? 'bg-emerald-500/5' : ''}`}>
              <td className="py-2 pr-3">
                <input
                  type="checkbox"
                  aria-label={`Select row ${p.rowIndex}`}
                  className="w-4 h-4 align-middle"
                  checked={selected.has(p.rowIndex)}
                  onChange={() => toggleRow(p.rowIndex)}
                />
              </td>
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
                <div className="text-white/90 line-clamp-2 break-words" title={p.title}>{p.title}</div>
                {p.primaryKeyword && p.primaryKeyword !== p.title && (
                  <div className="text-xs text-white/40 line-clamp-1">{p.primaryKeyword}</div>
                )}
              </td>
              <td className="py-2 pr-3">
                <EditableSeoCell
                  value={p.metaTitle || ''}
                  field="metaTitle"
                  placeholder="Add SEO title"
                  onSave={(next) => saveField(p, 'metaTitle', next)}
                  renderDisplay={(v) => <SeoDisplay value={v} kind="title" />}
                />
              </td>
              <td className="py-2 pr-3">
                <EditableSeoCell
                  value={p.metaDescription || ''}
                  field="metaDescription"
                  multiline
                  placeholder="Add meta description"
                  onSave={(next) => saveField(p, 'metaDescription', next)}
                  renderDisplay={(v) => <SeoDisplay value={v} kind="desc" />}
                />
              </td>
              <td className="py-2 pr-3 text-xs">
                <EditableSeoCell
                  value={p.keyword || ''}
                  field="keyword"
                  placeholder="Add focus keyphrase"
                  onSave={(next) => saveField(p, 'keyword', next)}
                  renderDisplay={(v) =>
                    v ? (
                      <span className="text-emerald-300/90 line-clamp-2 break-words" title={v}>{v}</span>
                    ) : (
                      <span className="text-white/25">— click to add</span>
                    )
                  }
                />
              </td>
              <td className="py-2 pr-3">
                <EditableTermsCell
                  values={p.categories || []}
                  suggestions={terms.categories}
                  label="category"
                  tone="category"
                  disabled={!terms.supports[p.route]}
                  disabledHint={`This site's ${p.route}s have no categories registered. Install or update the wp-publisher-yoast-rest mu-plugin to enable them.`}
                  onSave={(next) => saveTerms(p, 'categories', next)}
                />
              </td>
              <td className="py-2 pr-3">
                <EditableTermsCell
                  values={p.tags || []}
                  suggestions={terms.tags}
                  label="tag"
                  tone="tag"
                  disabled={!terms.supports[p.route]}
                  disabledHint={`This site's ${p.route}s have no tags registered. Install or update the wp-publisher-yoast-rest mu-plugin to enable them.`}
                  onSave={(next) => saveTerms(p, 'tags', next)}
                />
              </td>
              <td className="py-2 pr-3">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <button
                    onClick={() => handlePublish(p)}
                    disabled={busy}
                    className="text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1 disabled:opacity-40"
                    title="Publish live in WordPress and write the URL back to the sheet"
                  >
                    {activeRow === p.rowIndex ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Rocket className="w-3 h-3" />
                    )}
                    Publish
                  </button>
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
                {pubError && pubError.row === p.rowIndex && (
                  <div className="text-[11px] text-red-400 mt-1">{pubError.msg}</div>
                )}
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

// Yoast-style length scoring for SEO title and meta description.
// SEO Title: 50–60 chars = good, 30–49 or 61–70 = mid, else bad.
// Meta Description: 120–160 = good, 70–119 or 161–170 = mid, else bad.
type SeoStatus = 'good' | 'mid' | 'bad';
function scoreSeo(s: string, kind: 'title' | 'desc'): { count: number; status: SeoStatus } {
  const count = (s || '').length;
  if (!count) return { count: 0, status: 'bad' };
  if (kind === 'title') {
    if (count >= 50 && count <= 60) return { count, status: 'good' };
    if ((count >= 30 && count < 50) || (count > 60 && count <= 70)) return { count, status: 'mid' };
    return { count, status: 'bad' };
  }
  if (count >= 120 && count <= 160) return { count, status: 'good' };
  if ((count >= 70 && count < 120) || (count > 160 && count <= 170)) return { count, status: 'mid' };
  return { count, status: 'bad' };
}

function SeoScoreChip({ count, status }: { count: number; status: SeoStatus }) {
  const palette: Record<SeoStatus, string> = {
    good: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    mid: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    bad: 'bg-red-500/15 text-red-300 border-red-500/30',
  };
  const label: Record<SeoStatus, string> = {
    good: 'Passes the recommended length',
    mid: 'Acceptable but not ideal',
    bad: 'Fails the recommended length',
  };
  return (
    <span
      className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border whitespace-nowrap ${palette[status]}`}
      title={label[status]}
    >
      {count}
    </span>
  );
}

// Read-only rendering of an SEO title / meta description, colour-coded by
// length with its character-count chip. Shared by the Drafts and Published
// tabs so a field looks and scores identically in both.
function SeoDisplay({ value, kind }: { value: string; kind: 'title' | 'desc' }) {
  if (!value) return <span className="text-white/25 text-xs">— click to add</span>;
  const s = scoreSeo(value, kind);
  const tone =
    s.status === 'good' ? 'text-emerald-300' : s.status === 'mid' ? 'text-amber-300' : 'text-red-300';
  return (
    <div className="space-y-1">
      <div
        className={`${tone} text-xs break-words ${kind === 'desc' ? 'line-clamp-3' : 'line-clamp-2'}`}
        title={value}
      >
        {value}
      </div>
      <SeoScoreChip count={s.count} status={s.status} />
    </div>
  );
}

type EditableField = 'metaTitle' | 'metaDescription' | 'keyword';

function EditableSeoCell({
  value,
  field,
  multiline,
  placeholder,
  onSave,
  renderDisplay,
}: {
  value: string;
  field: EditableField;
  multiline?: boolean;
  placeholder: string;
  onSave: (next: string) => Promise<void>;
  renderDisplay: (value: string) => React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [savingError, setSavingError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  async function commit() {
    if (!editing) return;
    const next = (draft || '').trim();
    setEditing(false);
    if (next === (value || '').trim()) return; // no change
    setSaving(true);
    setSavingError(null);
    try {
      await onSave(next);
    } catch (e) {
      setSavingError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    const sharedProps = {
      ref: inputRef as React.RefObject<HTMLInputElement & HTMLTextAreaElement>,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (e.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        } else if (e.key === 'Enter' && !multiline) {
          e.preventDefault();
          (e.target as HTMLElement).blur();
        }
      },
      placeholder,
      className:
        'w-full bg-white/[0.06] border border-blue-400/40 rounded px-2 py-1 text-xs text-white outline-none focus:border-blue-400/80',
    };
    return multiline ? (
      <textarea rows={3} {...sharedProps} />
    ) : (
      <input type="text" {...sharedProps} />
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setEditing(true);
        }
      }}
      className={`group cursor-text rounded px-1 -mx-1 transition ${
        saving ? 'opacity-60' : 'hover:bg-white/[0.04]'
      }`}
      title={`Click to edit ${field === 'keyword' ? 'focus keyphrase' : field === 'metaTitle' ? 'SEO title' : 'meta description'}`}
    >
      {renderDisplay(value)}
      {saving && (
        <div className="text-[10px] text-blue-300 inline-flex items-center gap-1 mt-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Saving…
        </div>
      )}
      {savingError && (
        <div className="text-[10px] text-red-300 mt-1 break-words" title={savingError}>
          Save failed: {savingError.slice(0, 80)}
          {savingError.length > 80 ? '…' : ''}
        </div>
      )}
    </div>
  );
}

// Chip editor for one post's categories or tags. Chips remove on ×; the input
// adds on Enter, comma, or blur. Each change round-trips to WordPress
// immediately (same as the SEO cells) — with the parent list updated optimistically
// and rolled back if the save fails.
function EditableTermsCell({
  values,
  suggestions,
  label,
  tone,
  disabled,
  disabledHint,
  onSave,
}: {
  values: string[];
  suggestions: string[];
  label: string;
  tone: 'category' | 'tag';
  disabled?: boolean;
  disabledHint?: string;
  onSave: (next: string[]) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();

  if (disabled) {
    return <span className="text-white/20 text-xs" title={disabledHint}>n/a</span>;
  }

  async function commit(next: string[]) {
    setError(null);
    setSaving(true);
    try {
      await onSave(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function addDraft() {
    // Accept a pasted "a, b, c" in one go.
    const names = draft.split(',').map((s) => s.trim()).filter(Boolean);
    setDraft('');
    setAdding(false);
    if (!names.length) return;
    const existing = new Set(values.map((v) => v.toLowerCase()));
    const fresh = names.filter((n) => !existing.has(n.toLowerCase()));
    if (!fresh.length) return; // already on the post — nothing to save
    void commit([...values, ...fresh]);
  }

  const chipClass =
    tone === 'category'
      ? 'bg-emerald-500/10 text-emerald-300/90 hover:bg-emerald-500/20'
      : 'bg-white/5 text-white/60 hover:bg-white/10';

  // Don't suggest terms already on the post.
  const onPost = new Set(values.map((v) => v.toLowerCase()));
  const available = suggestions.filter((s) => !onPost.has(s.toLowerCase()));

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1 items-center">
        {values.map((v) => (
          <span
            key={v}
            className={`group text-[11px] px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${chipClass}`}
          >
            {tone === 'tag' ? `#${v}` : v}
            <button
              type="button"
              disabled={saving}
              onClick={() => void commit(values.filter((x) => x !== v))}
              className="opacity-40 group-hover:opacity-100 hover:text-red-300 disabled:opacity-20"
              title={`Remove ${v}`}
              aria-label={`Remove ${v}`}
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}

        {adding ? (
          <>
            <input
              autoFocus
              value={draft}
              list={listId}
              disabled={saving}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={addDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addDraft();
                } else if (e.key === 'Escape') {
                  setDraft('');
                  setAdding(false);
                }
              }}
              placeholder={`Add ${label}…`}
              className="bg-white/5 border border-white/20 rounded px-1.5 py-0.5 text-[11px] text-white/90 w-28 focus:outline-none focus:border-blue-400/60"
            />
            <datalist id={listId}>
              {available.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </>
        ) : (
          <button
            type="button"
            disabled={saving}
            onClick={() => setAdding(true)}
            className="text-[11px] text-white/30 hover:text-white/70 inline-flex items-center gap-0.5 disabled:opacity-40"
            title={`Add a ${label}. Type a new name to create it in WordPress.`}
          >
            <Plus className="w-2.5 h-2.5" /> {values.length ? '' : `Add ${label}`}
          </button>
        )}

        {saving && <Loader2 className="w-3 h-3 animate-spin text-blue-300/70" />}
      </div>
      {error && <div className="text-[11px] text-red-300/90 break-words">{error}</div>}
    </div>
  );
}

function WpPublishedTable({
  projectId,
  items,
  loading,
  error,
  onItemUpdated,
  terms,
  onTermsChanged,
}: {
  projectId: string;
  items: WpPublishedRow[] | null;
  loading: boolean;
  error: string | null;
  onItemUpdated: (row: WpPublishedRow) => void;
  terms: SiteTerms;
  onTermsChanged: () => void;
}) {
  const [q, setQ] = useState('');

  async function saveTerms(
    it: WpPublishedRow,
    taxonomy: 'categories' | 'tags',
    next: string[]
  ) {
    const saved = await saveTermList(projectId, it.id, it.type, taxonomy, next);
    onItemUpdated({ ...it, [taxonomy]: saved });
    onTermsChanged();
  }

  async function saveField(it: WpPublishedRow, field: EditableField, next: string) {
    const saved = await saveSeoField(projectId, it.id, it.type, field, next);
    onItemUpdated({
      ...it,
      metaTitle: saved.metaTitle ?? it.metaTitle,
      metaDescription: saved.metaDescription ?? it.metaDescription,
      keyword: saved.keyword ?? it.keyword,
    });
  }
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
      (it.link || '').toLowerCase().includes(needle) ||
      (it.categories || []).some((c) => c.toLowerCase().includes(needle)) ||
      (it.tags || []).some((t) => t.toLowerCase().includes(needle))
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
      {/* table-fixed divides the row by these widths, so they must cover every
          column and sum to 100% — a column left without one gets only the
          leftover, which mixing in px widths can drive to zero. The min-width
          lets the wrapper scroll on a narrow card instead of crushing cells. */}
      <table className="w-full text-sm table-fixed min-w-[1360px]">
        <thead className="text-left text-white/40 border-b border-white/10">
          <tr>
            <th className="py-2 pr-3 w-[7%]">Last modified</th>
            <th className="py-2 pr-3 w-[5%]">Type</th>
            <th className="py-2 pr-3 w-[13%]">Title</th>
            <th className="py-2 pr-3 w-[14%]">SEO Title</th>
            <th className="py-2 pr-3 w-[18%]">Meta Description</th>
            <th className="py-2 pr-3 w-[11%]">Keyword</th>
            <th className="py-2 pr-3 w-[13%]">Categories</th>
            <th className="py-2 pr-3 w-[13%]">Tags</th>
            <th className="py-2 pr-3 w-[6%]">Actions</th>
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
                <EditableSeoCell
                  value={it.metaTitle}
                  field="metaTitle"
                  placeholder="Add SEO title"
                  onSave={(next) => saveField(it, 'metaTitle', next)}
                  renderDisplay={(v) => <SeoDisplay value={v} kind="title" />}
                />
              </td>
              <td className="py-2 pr-3">
                <EditableSeoCell
                  value={it.metaDescription}
                  field="metaDescription"
                  multiline
                  placeholder="Add meta description"
                  onSave={(next) => saveField(it, 'metaDescription', next)}
                  renderDisplay={(v) => <SeoDisplay value={v} kind="desc" />}
                />
              </td>
              <td className="py-2 pr-3 text-xs">
                <EditableSeoCell
                  value={it.keyword}
                  field="keyword"
                  placeholder="Add focus keyphrase"
                  onSave={(next) => saveField(it, 'keyword', next)}
                  renderDisplay={(v) =>
                    v ? (
                      <span className="text-emerald-300/90 line-clamp-2 break-words" title={v}>
                        {v}
                      </span>
                    ) : (
                      <span
                        className="text-white/25"
                        title="Click to add a focus keyphrase. Requires the WP Publisher Yoast mu-plugin on the WP site."
                      >
                        — click to add
                      </span>
                    )
                  }
                />
              </td>
              <td className="py-2 pr-3">
                <EditableTermsCell
                  values={it.categories || []}
                  suggestions={terms.categories}
                  label="category"
                  tone="category"
                  disabled={!terms.supports[it.type]}
                  disabledHint={`This site's ${it.type}s have no categories registered. Install or update the wp-publisher-yoast-rest mu-plugin to enable them.`}
                  onSave={(next) => saveTerms(it, 'categories', next)}
                />
              </td>
              <td className="py-2 pr-3">
                <EditableTermsCell
                  values={it.tags || []}
                  suggestions={terms.tags}
                  label="tag"
                  tone="tag"
                  disabled={!terms.supports[it.type]}
                  disabledHint={`This site's ${it.type}s have no tags registered. Install or update the wp-publisher-yoast-rest mu-plugin to enable them.`}
                  onSave={(next) => saveTerms(it, 'tags', next)}
                />
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
