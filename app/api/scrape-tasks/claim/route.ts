import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyAgentToken } from '@/lib/agentAuth';

// GET /api/scrape-tasks/claim — laptop agent pulls the oldest pending task.
// Bearer <agent-token>. Claims atomically (skip locked) so two agents never
// get the same task. Returns { task } or { task: null } when none pending.
export async function GET(req: Request) {
  if (!(await verifyAgentToken(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const task = await db.claimScrapeTask();
  return NextResponse.json({ task });
}