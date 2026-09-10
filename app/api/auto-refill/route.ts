import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { autoRefillStatus, runAutoRefill, assertNotBusy } from '@/lib/autoRefill';

// GET /api/auto-refill — admin: current config + shared live run status.
export async function GET() {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const cfg = await db.getAppConfig();
  return NextResponse.json({
    enabled: cfg?.auto_refill_enabled || false,
    time: cfg?.auto_refill_time || '09:00',
    lastRunAt: cfg?.auto_refill_last_run || null,
    status: autoRefillStatus,
  });
}

// PUT /api/auto-refill — admin: enable/disable the nightly auto-refill + set time.
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({} as { enabled?: boolean; time?: string }));
  const enabled = Boolean(body.enabled);
  const time = typeof body.time === 'string' ? body.time.trim() : '09:00';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return NextResponse.json({ error: 'Time must be HH:MM (24h).' }, { status: 400 });
  }
  const cfg = await db.setAutoRefill({ enabled, time });
  return NextResponse.json({
    enabled: cfg.auto_refill_enabled,
    time: cfg.auto_refill_time,
    lastRunAt: cfg.auto_refill_last_run,
    message: enabled ? `Auto-refill enabled daily at ${time}.` : 'Auto-refill disabled.',
  });
}

// POST /api/auto-refill — admin: trigger a run NOW (manual), single-flight.
export async function POST() {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    assertNotBusy();
  } catch (e) {
    const status = (e as Error & { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
  // Fire-and-forget: run in background so the HTTP call returns the "started"
  // ack immediately while autoRefillStatus updates in real time for the UI.
  const p = runAutoRefill({ trigger: 'manual' });
  void p; // the caller polls /api/auto-refill for live status
  return NextResponse.json({
    started: true,
    message: 'Auto-refill started — check status for live progress.',
    status: autoRefillStatus,
  });
}