import { NextResponse } from 'next/server';
import { query } from '@/db/pool';

// Public read-only endpoint backing the receipts page's live platform panel.
// Returns only on-brand data: aggregate funnel counts, a few pseudo-named
// client high-levels (demo/archived clients excluded), and recent application
// rows (role + company + status). No emails, no PII, no internal ids.
export const dynamic = 'force-dynamic';

const PSEUDO: Record<string, string> = {
  'Kevin Thai': 'Kevin W.',
  'Kenneth Smith': 'Kenneth S.',
  'Olumuyiwa Ogungbade': 'Olumuyiwa O.',
};

function pseudo(name: string | null | undefined): string {
  if (name && PSEUDO[name]) return PSEUDO[name];
  if (name) return name.split(' ')[0] + '.';
  return 'Client';
}

export async function GET() {
  try {
    // 1) Funnel: real cumulative totals across the whole platform.
    const funnelRows = await query<{ status: string; c: number }>(
      `select status, count(*)::int as c from jobs group by status`
    );
    const by: Record<string, number> = {};
    for (const r of funnelRows.rows) by[r.status] = r.c;
    const funnel = {
      saved: by['saved'] ?? 0,
      tailored: by['tailored'] ?? 0,
      applied: by['applied'] ?? 0,
    };

    // 2) Client cards: active, non-demo, non-archived profiles with at least
    // one application submitted. Demo + archived are excluded from the public
    // panel.
    const clientRows = await query<{ name: string; ingested: number; tailored: number; applied: number }>(
      `select p.name,
              count(j.id)::int as ingested,
              count(j.id) filter (where j.status = 'tailored')::int as tailored,
              count(j.id) filter (where j.status = 'applied')::int as applied
         from profiles p
         join jobs j on j.profile_id = p.id
        where p.deleted_at is null
          and p.name not in ('Demo Client', 'example')
          and p.name is not null
        group by p.name
       having count(j.id) filter (where j.status = 'applied') > 0
        order by applied desc
        limit 6`
    );
    const clients = clientRows.rows.map((r) => ({
      name: pseudo(r.name),
      ingested: r.ingested,
      tailored: r.tailored,
      applied: r.applied,
    }));

    // 3) Recent ticker: most recently touched applied/tailored rows.
    const recentRows = await query<{ pname: string; title: string; company: string; status: string }>(
      `select p.name as pname, j.title, j.company, j.status
         from jobs j
         join profiles p on p.id = j.profile_id
        where j.status in ('applied', 'tailored')
          and p.deleted_at is null
          and p.name not in ('Demo Client', 'example')
        order by j.updated_at desc
        limit 6`
    );
    const recent = recentRows.rows.map((r) => ({
      client: pseudo(r.pname),
      role: r.title,
      company: r.company,
      status: r.status === 'applied' ? 'Applied' : 'Tailored',
    }));

    return NextResponse.json({ ok: true, funnel, clients, recent });
  } catch (e) {
    console.error('[receipts]', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { ok: false, error: 'failed to load receipts data', funnel: { saved: 0, tailored: 0, applied: 0 }, clients: [], recent: [] },
      { status: 500 }
    );
  }
}