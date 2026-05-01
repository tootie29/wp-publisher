// lib/scheduler.ts
import { runAll } from './worker';

export { getLiveState, updateLiveState } from './live-state';
export type { LiveRunState } from './live-state';

declare global {
  // eslint-disable-next-line no-var
  var __wpPublisherScheduler: { timer?: NodeJS.Timeout; running: boolean } | undefined;
}

function minutes() {
  const m = parseInt(process.env.POLL_INTERVAL_MINUTES || '5', 10);
  return isNaN(m) || m < 1 ? 5 : m;
}

export function startScheduler() {
  if (!globalThis.__wpPublisherScheduler) {
    globalThis.__wpPublisherScheduler = { running: false };
  }
  const s = globalThis.__wpPublisherScheduler!;
  if (s.timer) return;
  const interval = minutes() * 60 * 1000;

  const tick = async () => {
    if (s.running) return;
    s.running = true;
    try { await runAll(); } finally { s.running = false; }
  };

  setTimeout(tick, 5000);
  s.timer = setInterval(tick, interval);
  // eslint-disable-next-line no-console
  console.log(`[scheduler] started, polling every ${minutes()} min`);
}

export function isRunning(): boolean {
  return !!globalThis.__wpPublisherScheduler?.running;
}
