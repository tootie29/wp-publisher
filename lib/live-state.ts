// lib/live-state.ts
// Shared in-memory live run state. Separate module to avoid worker<->scheduler cycle.

export interface LiveRunState {
  running: boolean;
  projectId: string | null;
  rowIndex: number | null;
  phase: 'idle' | 'polling' | 'extracting' | 'publishing' | 'writeback' | 'done';
  message: string;
  updatedAt: string;
  cancelRequested: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __wpPublisherLiveState: LiveRunState | undefined;
}

export function getLiveState(): LiveRunState {
  if (!globalThis.__wpPublisherLiveState) {
    globalThis.__wpPublisherLiveState = {
      running: false,
      projectId: null,
      rowIndex: null,
      phase: 'idle',
      message: '',
      updatedAt: new Date().toISOString(),
      cancelRequested: false,
    };
  }
  return globalThis.__wpPublisherLiveState!;
}

export function updateLiveState(patch: Partial<LiveRunState>) {
  const curr = getLiveState();
  globalThis.__wpPublisherLiveState = {
    ...curr,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}
