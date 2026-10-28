import { NextResponse } from 'next/server';
import { query } from '@/db/pool';
import { genLicenseKey, TIERS } from '@/lib/applyos';

// POST /api/applyos/license/trial { email, machine }
// 3-day trial, 5 tailored applications, one per email (applyos_trials table),
// machine-bound. Trial includes the mailbox agent preview (the converter per
// docs/pricing-tiers.md §6).
export async function POST(req: Request) {
  const { email, machine } = await req.json().catch(() => ({}) as { email?: string; machine?: string });
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'valid email required' }, { status: 400 });
  }

  const existing = await query<{ license_id: string }>(
    'select license_id from applyos_trials where lower(email) = lower($1)',
    [email]
  );
  if (existing.rows.length) {
    return NextResponse.json({ error: 'trial already used for this email', licenseKey: existing.rows[0].license_id }, { status: 409 });
  }

  const key = genLicenseKey();
  const expires = new Date(Date.now() + TIERS.trial.cycleDays * 86400000).toISOString();
  const machines = machine ? JSON.stringify([machine]) : '[]';

  await query(
    `insert into applyos_licenses (id, email, plan, cycle_days, expires_at, machines, tailor_quota, meter_reset_at, features)
     values ($1, $2, 'trial', $3, $4, $5, $6, $7, $8)`,
    [key, email, TIERS.trial.cycleDays, expires, machines, TIERS.trial.apps, expires,
     JSON.stringify({ mailbox: true, japaFilters: false, parallel: false })]
  );
  await query('insert into applyos_trials (email, license_id) values ($1, $2)', [email.toLowerCase(), key]);

  return NextResponse.json({ licenseKey: key, expiresAt: expires, tailoredIncluded: TIERS.trial.apps });
}
