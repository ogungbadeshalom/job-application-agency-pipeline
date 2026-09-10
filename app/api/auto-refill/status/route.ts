import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { autoRefillStatus } from '@/lib/autoRefill';

// GET /api/auto-refill/status — ANY authenticated role (worker/admin/client).
// Lightweight real-time status the worker queue polls every ~3s. Returns only
// the safe summary fields (no DB queries, no secrets) so it's cheap to poll.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const s = autoRefillStatus;
  return NextResponse.json({
    active: s.active,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    totalProfiles: s.totalProfiles,
    doneProfiles: s.doneProfiles,
    totalJobsAdded: s.totalJobsAdded,
    currentName: s.currentName,
    currentStep: s.currentStep,
    currentJobsFound: s.currentJobsFound,
    message: s.message,
    trigger: s.trigger,
  });
}