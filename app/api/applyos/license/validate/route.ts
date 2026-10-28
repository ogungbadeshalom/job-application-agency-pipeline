import { NextResponse } from 'next/server';
import { query } from '@/db/pool';
import { bindAndMeter, genLicenseKey, TIERS, type Tier } from '@/lib/applyos';
import { isUuid } from '@/lib/validate';

// GET /api/applyos/license/validate?key=APPLYOS-...&machine=<machineGuid>
// Desktop app phone-home: binds machine (max 2), rolls the meter cycle,
// returns plan + limits + remaining tailor count. 72h offline grace is the
// CLIENT's job (cached last-known-good state); this endpoint is pure truth.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = (url.searchParams.get('key') || '').trim();
  const machine = (url.searchParams.get('machine') || '').trim();
  if (!key.startsWith('APPLYOS-')) {
    return NextResponse.json({ valid: false, reason: 'bad-key-format' }, { status: 400 });
  }
  const r = await bindAndMeter(key, machine);
  if (!r.ok) return NextResponse.json({ valid: false, reason: r.reason }, { status: 200 });

  const daysRemaining = Math.max(
    0,
    Math.ceil((new Date(r.lic.expires_at).getTime() - Date.now()) / 86400000)
  );
  return NextResponse.json({
    valid: true,
    plan: r.lic.plan,
    daysRemaining,
    tier: {
      applicationsPerCycle: r.lic.tailor_quota,
      cycleDays: r.lic.cycle_days,
      mailbox: r.tier.mailbox,
      japaFilters: r.tier.japaFilters,
      parallel: r.tier.parallel,
    },
    tailorRemaining: r.tailorRemaining,
    creditsRemaining: r.creditsRemaining,
  });
}

// POST /api/applyos/license/validate — same via POST body (some proxies eat
// query strings in Electron net module).
export async function POST(req: Request) {
  const { key, machine } = await req.json().catch(() => ({}) as { key?: string; machine?: string });
  if (!key) return NextResponse.json({ valid: false, reason: 'key-required' }, { status: 400 });
  const u = new URL(req.url);
  return GET(new Request(`${u.origin}${u.pathname}?key=${encodeURIComponent(key)}&machine=${encodeURIComponent(machine || '')}`));
}
