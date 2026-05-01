// app/api/worker/status/route.ts
import { NextResponse } from 'next/server';
import { getLiveState } from '@/lib/scheduler';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getLiveState());
}
