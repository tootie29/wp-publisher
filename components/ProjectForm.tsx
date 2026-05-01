// components/ProjectForm.tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Save, Loader2, Trash2, CheckCircle2, AlertCircle, Plug, Plus, X
} from 'lucide-react';
import type { ProjectConfig, PageTypeRoute } from '@/lib/types';

interface Props {
  initial?: ProjectConfig;
  mode: 'create' | 'edit';
}

function defaultConfig(): ProjectConfig {
  return {
    id: '',
    name: '',
    enabled: true,
    wordpress: { baseUrl: '', username: '', appPassword: '' },
    sheet: {
      sheetId: '',
      tabName: 'Content Calendar',
      columns: {
        status: 'A',
        pageType: 'D',
        primaryKeyword: 'H',
        contentLink: 'L',
        contentType: 'M',
        targetUrl: 'N',
      },
      headerRow: 1,
      triggerValue: 'In-Progress',
      completedValue: 'Content Live',
    },
    pageTypeRouting: {
      'blog': 'post',
      'blog post': 'post',
      'blog page': 'post',
      'cluster': 'page',
      'cluster content': 'page',
      'cluster sub practice': 'page',
      'location page': 'page',
      'practice area page': 'page',
      'sub cluster': 'page',
      'resource': 'page',
    },
    publishStatus: 'draft',
  };
}

export default function ProjectForm({ initial, mode }: Props) {
  const router = useRouter();
  const [cfg, setCfg] = useState<ProjectConfig>(initial || defaultConfig());
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    sheet: { ok: boolean; rowCount?: number; headerRow?: string[]; error?: string };
    wp: { ok: boolean; username?: string; error?: string };
  } | null>(null);

  function update<K extends keyof ProjectConfig>(key: K, value: ProjectConfig[K]) {
    setCfg({ ...cfg, [key]: value });
  }

  function updateWp(field: keyof ProjectConfig['wordpress'], value: string) {
    setCfg({ ...cfg, wordpress: { ...cfg.wordpress, [field]: value } });
  }

  function updateSheet<K extends keyof ProjectConfig['sheet']>(
    field: K,
    value: ProjectConfig['sheet'][K]
  ) {
    setCfg({ ...cfg, sheet: { ...cfg.sheet, [field]: value } });
  }

  function updateColumn(field: keyof ProjectConfig['sheet']['columns'], value: string) {
    setCfg({
      ...cfg,
      sheet: {
        ...cfg.sheet,
        columns: { ...cfg.sheet.columns, [field]: value.toUpperCase().trim() },
      },
    });
  }

  // Some legacy projects don't have these new columns set. Show fallbacks so
  // the inputs are never undefined (controlled-input warning).
  const cols = cfg.sheet.columns;
  const colContentType = cols.contentType ?? '';
  const colTargetUrl = cols.targetUrl ?? '';

  async function handleTest() {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const res = await fetch('/api/projects/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setTestResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const url = mode === 'edit' ? `/api/projects/${initial!.id}` : '/api/projects';
      const method = mode === 'edit' ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      router.push('/wp-publisher');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!initial) return;
    if (!confirm(`Delete project "${initial.name}"? Published posts will remain in WordPress.`)) return;
    await fetch(`/api/projects/${initial.id}`, { method: 'DELETE' });
    router.push('/wp-publisher');
    router.refresh();
  }

  // Page type routing handlers
  const routeEntries = Object.entries(cfg.pageTypeRouting);
  function updateRoute(oldKey: string, newKey: string, newRoute: PageTypeRoute) {
    const next = { ...cfg.pageTypeRouting };
    if (oldKey !== newKey) delete next[oldKey];
    if (newKey) next[newKey.toLowerCase()] = newRoute;
    update('pageTypeRouting', next);
  }
  function addRoute() {
    update('pageTypeRouting', { ...cfg.pageTypeRouting, '': 'page' });
  }
  function removeRoute(key: string) {
    const next = { ...cfg.pageTypeRouting };
    delete next[key];
    update('pageTypeRouting', next);
  }

  return (
    <div className="space-y-6">
      {/* Basic */}
      <Section title="Basic">
        <Field label="Project name" hint="Display name only, e.g. 'Forte Law Firm'">
          <input
            type="text"
            value={cfg.name}
            onChange={(e) => update('name', e.target.value)}
            className={inputClass}
            placeholder="Forte Law Firm"
          />
        </Field>
        <Field label="Enabled" hint="Unchecked projects are skipped by the scheduler">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={cfg.enabled}
              onChange={(e) => update('enabled', e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm text-white/70">Active</span>
          </label>
        </Field>
      </Section>

      {/* WordPress */}
      <Section title="WordPress">
        <Field label="Site URL" hint="https://www.example.com (no trailing slash needed)">
          <input
            type="url"
            value={cfg.wordpress.baseUrl}
            onChange={(e) => updateWp('baseUrl', e.target.value.replace(/\/+$/, ''))}
            className={inputClass}
            placeholder="https://www.fortelawgroup.com"
          />
        </Field>
        <Field label="Username" hint="Your WP admin username">
          <input
            type="text"
            value={cfg.wordpress.username}
            onChange={(e) => updateWp('username', e.target.value)}
            className={inputClass}
            placeholder="admin"
          />
        </Field>
        <Field
          label="Application password"
          hint="WP admin → Users → Profile → Application Passwords. Paste the 24-char password (spaces OK)."
        >
          <input
            type="password"
            value={cfg.wordpress.appPassword}
            onChange={(e) => updateWp('appPassword', e.target.value)}
            className={inputClass + ' font-mono'}
            placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
          />
        </Field>
        <Field label="Publish status" hint="'draft' is safest — you review in WP admin before going live">
          <select
            value={cfg.publishStatus}
            onChange={(e) => update('publishStatus', e.target.value as ProjectConfig['publishStatus'])}
            className={inputClass}
          >
            <option value="draft">Draft (safe)</option>
            <option value="pending">Pending review</option>
            <option value="publish">Publish immediately</option>
          </select>
        </Field>
      </Section>

      {/* Google Sheet */}
      <Section title="Google Sheet">
        <Field label="Sheet ID" hint="The long string from the sheet URL between /d/ and /edit">
          <input
            type="text"
            value={cfg.sheet.sheetId}
            onChange={(e) => updateSheet('sheetId', e.target.value.trim())}
            className={inputClass + ' font-mono text-sm'}
            placeholder="1_d0yMpxWrHHoblzgTCbzvNqrFNqDwRSFjt8q5OKj7W8"
          />
        </Field>
        <Field label="Tab name" hint="Exact name of the tab (bottom of Google Sheets)">
          <input
            type="text"
            value={cfg.sheet.tabName}
            onChange={(e) => updateSheet('tabName', e.target.value)}
            className={inputClass}
            placeholder="Content Calendar"
          />
        </Field>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Status column" hint="e.g. A">
            <input type="text" value={cfg.sheet.columns.status}
              onChange={(e) => updateColumn('status', e.target.value)}
              className={inputClass + ' uppercase'} maxLength={2} />
          </Field>
          <Field label="Page Type column" hint="e.g. D">
            <input type="text" value={cfg.sheet.columns.pageType}
              onChange={(e) => updateColumn('pageType', e.target.value)}
              className={inputClass + ' uppercase'} maxLength={2} />
          </Field>
          <Field label="Keyword column" hint="e.g. H">
            <input type="text" value={cfg.sheet.columns.primaryKeyword}
              onChange={(e) => updateColumn('primaryKeyword', e.target.value)}
              className={inputClass + ' uppercase'} maxLength={2} />
          </Field>
          <Field label="Content Link column" hint="e.g. L">
            <input type="text" value={cfg.sheet.columns.contentLink}
              onChange={(e) => updateColumn('contentLink', e.target.value)}
              className={inputClass + ' uppercase'} maxLength={2} />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field
            label="Content Type column"
            hint={`Cell value should be "New Content" or "Content Refresh". Leave blank if you don't use this — every row is treated as new.`}
          >
            <input type="text" value={colContentType}
              onChange={(e) => updateColumn('contentType', e.target.value)}
              className={inputClass + ' uppercase'} maxLength={2}
              placeholder="e.g. M" />
          </Field>
          <Field
            label="Target URL column (optional)"
            hint={`Optional. If a "Content Refresh" row has a URL here, we use it to find the existing post. If left blank, we'll match the post by Primary Keyword instead. Ignored on "New Content" rows.`}
          >
            <input type="text" value={colTargetUrl}
              onChange={(e) => updateColumn('targetUrl', e.target.value)}
              className={inputClass + ' uppercase'} maxLength={2}
              placeholder="e.g. N" />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Header row" hint="Data starts on row after this">
            <input type="number" min={0} value={cfg.sheet.headerRow}
              onChange={(e) => updateSheet('headerRow', parseInt(e.target.value) || 1)}
              className={inputClass} />
          </Field>
          <Field label="Trigger value" hint="Rows where status = this get published">
            <input type="text" value={cfg.sheet.triggerValue}
              onChange={(e) => updateSheet('triggerValue', e.target.value)}
              className={inputClass} />
          </Field>
          <Field label="Completed value" hint="Status set after successful publish">
            <input type="text" value={cfg.sheet.completedValue}
              onChange={(e) => updateSheet('completedValue', e.target.value)}
              className={inputClass} />
          </Field>
        </div>
      </Section>

      {/* Page Type Routing */}
      <Section
        title="Page Type routing"
        subtitle="Map each Page Type value from Column D to 'post' or 'page' in WordPress. Keys are case-insensitive."
      >
        <div className="space-y-2">
          {routeEntries.map(([key, route], i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                type="text"
                value={key}
                onChange={(e) => updateRoute(key, e.target.value, route)}
                placeholder="Page Type value (e.g. blog)"
                className={inputClass + ' flex-1'}
              />
              <span className="text-white/40">→</span>
              <select
                value={route}
                onChange={(e) => updateRoute(key, key, e.target.value as PageTypeRoute)}
                className={inputClass + ' w-32'}
              >
                <option value="post">post</option>
                <option value="page">page</option>
              </select>
              <button
                onClick={() => removeRoute(key)}
                className="p-2 text-white/40 hover:text-red-400"
                title="Remove"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            onClick={addRoute}
            className="text-sm text-white/60 hover:text-white inline-flex items-center gap-1 mt-2"
          >
            <Plus className="w-4 h-4" /> Add Page Type
          </button>
        </div>
      </Section>

      {/* Test */}
      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Test connection</h3>
          <button
            onClick={handleTest}
            disabled={testing}
            className="text-sm px-3 py-2 rounded border border-white/10 hover:border-white/30 inline-flex items-center gap-2"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
            Test now
          </button>
        </div>
        <p className="text-sm text-white/50 mb-3">
          Verifies your WP app password and that the service account can read the sheet. No data is saved.
        </p>
        {testResult && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ResultBox
              label="Google Sheet"
              ok={testResult.sheet.ok}
              detail={
                testResult.sheet.ok
                  ? `${testResult.sheet.rowCount} rows · tab found`
                  : testResult.sheet.error
              }
            />
            <ResultBox
              label="WordPress"
              ok={testResult.wp.ok}
              detail={
                testResult.wp.ok
                  ? `Authenticated as ${testResult.wp.username}`
                  : testResult.wp.error
              }
            />
          </div>
        )}
      </section>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-4 border-t border-white/10">
        <button
          onClick={() => router.push('/wp-publisher')}
          className="text-sm text-white/60 hover:text-white"
        >
          ← Cancel
        </button>
        <div className="flex gap-2">
          {mode === 'edit' && (
            <button
              onClick={handleDelete}
              className="text-sm px-4 py-2 rounded border border-red-500/20 hover:border-red-500/40 text-red-300 inline-flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" /> Delete project
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-sm px-5 py-2 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 inline-flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {mode === 'edit' ? 'Save changes' : 'Create project'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  'w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-white placeholder-white/30 focus:border-white/40 focus:outline-none text-sm';

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
      <h3 className="font-semibold mb-1">{title}</h3>
      {subtitle && <p className="text-sm text-white/50 mb-4">{subtitle}</p>}
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm text-white/80 mb-1">{label}</label>
      {children}
      {hint && <div className="text-xs text-white/40 mt-1">{hint}</div>}
    </div>
  );
}

function ResultBox({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div
      className={`rounded border p-3 text-sm flex items-start gap-2 ${
        ok
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-red-500/30 bg-red-500/5'
      }`}
    >
      {ok ? (
        <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-400 shrink-0" />
      ) : (
        <AlertCircle className="w-4 h-4 mt-0.5 text-red-400 shrink-0" />
      )}
      <div>
        <div className="text-white/80 font-medium">{label}</div>
        <div className={ok ? 'text-white/60 text-xs' : 'text-red-400/80 text-xs'}>{detail}</div>
      </div>
    </div>
  );
}
