'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import ProjectRow, { type PublicProject } from './ProjectRow';

type Filter = 'all' | 'watching' | 'paused' | 'running';

interface LiveState {
  running: boolean;
  projectId: string | null;
}

export default function ProjectList({ projects }: { projects: PublicProject[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [live, setLive] = useState<LiveState | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const data = await fetch('/api/worker/status').then((r) => r.json());
        if (alive) setLive(data);
      } catch {}
    }
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const runningId = live?.running ? live.projectId : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => {
      if (filter === 'watching' && (!p.enabled || runningId === p.id)) return false;
      if (filter === 'paused' && p.enabled) return false;
      if (filter === 'running' && runningId !== p.id) return false;
      if (!q) return true;
      const host = p.wordpress.baseUrl.toLowerCase();
      return p.name.toLowerCase().includes(q) || host.includes(q) || p.id.toLowerCase().includes(q);
    });
  }, [projects, query, filter, runningId]);

  const counts = useMemo(() => {
    const watching = projects.filter((p) => p.enabled && runningId !== p.id).length;
    const paused = projects.filter((p) => !p.enabled).length;
    const running = projects.filter((p) => runningId === p.id).length;
    return { all: projects.length, watching, paused, running };
  }, [projects, runningId]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects by name or website…"
            className="w-full bg-white/[0.03] border border-white/10 rounded-lg pl-9 pr-9 py-2 text-sm placeholder:text-white/30 focus:border-white/30 focus:outline-none focus:bg-white/[0.05]"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/10"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5 text-white/50" />
            </button>
          )}
        </div>
        <div className="flex gap-1 bg-white/[0.03] border border-white/10 rounded-lg p-1 self-start">
          <FilterBtn active={filter === 'all'} onClick={() => setFilter('all')}>
            All <Pill>{counts.all}</Pill>
          </FilterBtn>
          <FilterBtn active={filter === 'running'} onClick={() => setFilter('running')}>
            Running <Pill tone="blue">{counts.running}</Pill>
          </FilterBtn>
          <FilterBtn active={filter === 'watching'} onClick={() => setFilter('watching')}>
            Watching <Pill tone="emerald">{counts.watching}</Pill>
          </FilterBtn>
          <FilterBtn active={filter === 'paused'} onClick={() => setFilter('paused')}>
            Paused <Pill>{counts.paused}</Pill>
          </FilterBtn>
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 p-10 text-center text-white/50 text-sm">
          {query || filter !== 'all'
            ? 'No projects match this view. Try clearing your search or filter.'
            : 'No projects yet — click "Add project" to connect your first client site.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <ProjectRow key={p.id} project={p} isRunning={runningId === p.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 transition ${
        active ? 'bg-white/10 text-white' : 'text-white/55 hover:text-white/80 hover:bg-white/[0.04]'
      }`}
    >
      {children}
    </button>
  );
}

function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'blue' | 'emerald' }) {
  const cls =
    tone === 'blue'
      ? 'bg-blue-500/15 text-blue-200'
      : tone === 'emerald'
      ? 'bg-emerald-500/10 text-emerald-300'
      : 'bg-white/5 text-white/55';
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls}`}>{children}</span>
  );
}
