// app/api/logs/route.ts
import { NextResponse } from 'next/server';
import { readAllLogs, readLogs } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get('projectId');
  const limit = parseInt(url.searchParams.get('limit') || '200', 10);
  const logs = projectId ? readLogs(projectId, limit) : readAllLogs(limit);
  return NextResponse.json({ logs });
}
