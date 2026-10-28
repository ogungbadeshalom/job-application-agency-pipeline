import { NextResponse } from 'next/server';
import { query } from '@/db/pool';

// POST /api/applyos/telemetry { machineId, appVersion, applied, failed, skipped, crashStack }
// No personal data, no URLs — run counts and crash stacks only.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const n = (v: unknown) => Math.max(0, Math.min(100000, Number(v) || 0));
  await query(
    `insert into applyos_telemetry (machine_id, app_version, applied, failed, skipped, crash_stack)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      String(b.machineId || '').slice(0, 128) || null,
      String(b.appVersion || '').slice(0, 32) || null,
      n(b.applied), n(b.failed), n(b.skipped),
      b.crashStack ? String(b.crashStack).slice(0, 8000) : null,
    ]
  );
  return NextResponse.json({ ok: true });
}
