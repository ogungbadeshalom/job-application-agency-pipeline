// ApplyOS server core: tier map, key generation, license validation + metering.
// Nigeria-first launch per docs/pricing-tiers.md (in the ApplyOS repo).
// The tailor meter lives HERE, server-side — the desktop app can never inflate it.

import { query } from '../db/pool';

export type Tier = 'trial' | 'starter' | 'pro' | 'japa';

export const TIERS: Record<
  Tier,
  { apps: number; cycleDays: number; price: number; mailbox: boolean; japaFilters: boolean; parallel: boolean }
> = {
  trial: { apps: 5, cycleDays: 3, price: 0, mailbox: true, japaFilters: false, parallel: false },
  starter: { apps: 100, cycleDays: 7, price: 5000, mailbox: false, japaFilters: false, parallel: false },
  pro: { apps: 100, cycleDays: 30, price: 18000, mailbox: true, japaFilters: false, parallel: false },
  japa: { apps: 60, cycleDays: 30, price: 49000, mailbox: true, japaFilters: true, parallel: true },
};

// Flutterwave amount (NGN major units) → what was bought. Verified tx only.
export const NGN_PRODUCTS: { amount: number; kind: 'plan' | 'credits'; plan?: Tier; apps?: number }[] = [
  { amount: 5000, kind: 'plan', plan: 'starter' },
  { amount: 18000, kind: 'plan', plan: 'pro' },
  { amount: 49000, kind: 'plan', plan: 'japa' },
  { amount: 2000, kind: 'credits', apps: 10 },
  { amount: 8000, kind: 'credits', apps: 45 },
  { amount: 18000, kind: 'credits', apps: 100 },
];

export function matchNgnProduct(amountMajor: number) {
  return NGN_PRODUCTS.find((p) => p.amount === amountMajor) || null;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function genLicenseKey(): string {
  const block = (n: number) =>
    Array.from({ length: n }, () => CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)]).join('');
  return `APPLYOS-${block(5)}-${block(5)}-${block(5)}`;
}

export type LicenseRow = {
  id: string;
  email: string;
  plan: Tier;
  cycle_days: number;
  expires_at: string;
  machines: string;
  tailor_quota: number;
  tailor_used: number;
  meter_reset_at: string;
  features: string;
  disabled: boolean;
};

export function getLicense(key: string): Promise<LicenseRow | null> {
  return query<LicenseRow>('select * from applyos_licenses where id = $1', [key]).then((r) => r.rows[0] || null);
}

// Meter-reset rollforward + machine binding (max 2) + expiry check, in one pass.
export async function bindAndMeter(key: string, machine: string) {
  const lic = await getLicense(key);
  if (!lic) return { ok: false as const, status: 404, reason: 'key-not-found' };
  if (lic.disabled) return { ok: false as const, status: 403, reason: 'disabled' };
  if (new Date(lic.expires_at) < new Date()) return { ok: false as const, status: 403, reason: 'expired' };

  // roll the meter forward if the cycle elapsed
  let { tailor_used, meter_reset_at, machines } = lic;
  if (new Date(meter_reset_at) < new Date()) {
    tailor_used = 0;
    const next = new Date();
    next.setDate(next.getDate() + lic.cycle_days);
    meter_reset_at = next.toISOString();
    await query('update applyos_licenses set tailor_used=0, meter_reset_at=$2 where id=$1', [key, meter_reset_at]);
  }

  const bound: string[] = JSON.parse(machines || '[]');
  if (machine && !bound.includes(machine)) {
    if (bound.length >= 2) return { ok: false as const, status: 403, reason: 'machine-limit' };
    bound.push(machine);
    machines = JSON.stringify(bound);
    await query('update applyos_licenses set machines=$2 where id=$1', [key, machines]);
  }

  const credits = await query<{ apps_remaining: number; id: number }>(
    `select id, apps_remaining from applyos_credits
      where license_id=$1 and apps_remaining > 0 and expires_at > now()
      order by expires_at asc`,
    [key]
  );
  const creditsRemaining = credits.rows.reduce((s, r) => s + r.apps_remaining, 0);
  const tailorRemaining = Math.max(0, lic.tailor_quota - tailor_used) + creditsRemaining;

  return {
    ok: true as const,
    lic: { ...lic, tailor_used, meter_reset_at, machines },
    tailorRemaining,
    creditsRemaining,
    tier: TIERS[lic.plan as Tier] || TIERS.trial,
  };
}

// Consume one tailored application: tier meter first, then oldest credits.
// Returns the source consumed, or exhausted if nothing remains.
export async function consumeTailor(key: string): Promise<'tier' | 'credit' | 'exhausted'> {
  const lic = await getLicense(key);
  if (!lic) return 'exhausted';
  if (lic.tailor_used < lic.tailor_quota) {
    await query('update applyos_licenses set tailor_used = tailor_used + 1 where id=$1', [key]);
    return 'tier';
  }
  const c = await query<{ id: number }>(
    `select id from applyos_credits
      where license_id=$1 and apps_remaining > 0 and expires_at > now()
      order by expires_at asc limit 1`,
    [key]
  );
  if (c.rows.length) {
    await query('update applyos_credits set apps_remaining = apps_remaining - 1 where id=$1', [c.rows[0].id]);
    return 'credit';
  }
  return 'exhausted';
}
