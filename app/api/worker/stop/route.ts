// app/api/worker/stop/route.ts
import { NextResponse } from 'next/server';
import { getLiveState, updateLiveState } from '@/lib/live-state';

export const dynamic = 'force-dynamic';

export async function POST() {
  const state = getLiveState();
  if (!state.running) {
    return NextResponse.json({ ok: true, wasRunning: false });
  }
  updateLiveState({ cancelRequested: true });
  return NextResponse.json({ ok: true, wasRunning: true });
}
