// app/wp-publisher/logs/page.tsx
import { readAllLogs } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const LEVEL_COLORS: Record<string, string> = {
  info: 'text-white/60',
  warn: 'text-amber-400',
  error: 'text-red-400',
  success: 'text-emerald-400',
};

export default function LogsPage() {
  const logs = readAllLogs(300);

  return (
    <>
      <main className="max-w-6xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-semibold mb-1">Logs</h1>
        <p className="text-white/50 mb-8 text-sm">Most recent 300 entries across all projects</p>

        {logs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/15 p-10 text-center text-white/50">
            No logs yet. Run the worker to generate activity.
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 overflow-hidden bg-white/[0.02]">
            <table className="w-full text-sm">
              <thead className="text-left text-white/40 bg-white/[0.03]">
                <tr>
                  <th className="px-4 py-2 w-44">Time</th>
                  <th className="px-4 py-2 w-32">Project</th>
                  <th className="px-4 py-2 w-14">Row</th>
                  <th className="px-4 py-2 w-20">Level</th>
                  <th className="px-4 py-2">Message</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l, i) => (
                  <tr key={i} className="border-t border-white/5 align-top">
                    <td className="px-4 py-2 text-white/50 font-mono text-xs whitespace-nowrap">
                      {new Date(l.ts).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-white/70">{l.projectId}</td>
                    <td className="px-4 py-2 text-white/50">{l.rowIndex ?? ''}</td>
                    <td className={`px-4 py-2 font-medium ${LEVEL_COLORS[l.level] || 'text-white/60'}`}>
                      {l.level}
                    </td>
                    <td className="px-4 py-2 text-white/80">
                      {l.message}
                      {l.meta && Object.keys(l.meta).length > 0 && (
                        <details className="mt-1">
                          <summary className="text-xs text-white/40 cursor-pointer">meta</summary>
                          <pre className="text-xs text-white/50 mt-1 whitespace-pre-wrap">
                            {JSON.stringify(l.meta, null, 2)}
                          </pre>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
