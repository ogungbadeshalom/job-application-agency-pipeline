import { NextResponse } from 'next/server';
import { query } from '@/db/pool';

// GET /api/stats — public: REAL pipeline numbers for the landing page.
// One query, no auth, client-cached 5 min (Cache-Control). Returns zeros on
// any DB hiccup so the landing never breaks over it.

// Tiny in-process cache: the numbers move on weekly cadence, not per request.
let cached: { data: StatsData; at: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

type StatsData = {
  totalApplied: number;
  last7d: number;
  companies: number;
  avgReview: number;
  reviewCount: number;
  recent: { title: string; company: string; at: string }[];
};

export async function GET() {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(cached.data, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  }
  try {
    const r = await query(`
      select
        (select count(*) from jobs where status = 'applied')::int as total_applied,
        (select count(*) from jobs where status = 'applied'
           and submitted_at > now() - interval '7 days')::int as last7d,
        (select count(distinct lower(company)) from jobs
           where status = 'applied'
             and company !~* 'job|^boards$|^jobs$|career|external|untitled|candidate|portal')::int as companies,
        (select coalesce(round(avg(stars)::numeric, 1), 0) from reviews where status = 'approved')::float as avg_review,
        (select count(*) from reviews where status = 'approved')::int as review_count
    `);
    const recent = await query(
      `select title, company, to_char(submitted_at, 'HH24:MI') as at
       from jobs
       where status = 'applied' and submitted_at is not null
         and company !~* 'job|^boards$|^jobs$|career|external|untitled|candidate|portal'
       order by submitted_at desc limit 8`
    );
    const row = r.rows[0];
    const data: StatsData = {
      totalApplied: Number(row.total_applied),
      last7d: Number(row.last7d),
      companies: Number(row.companies),
      avgReview: Number(row.avg_review),
      reviewCount: Number(row.review_count),
      recent: recent.rows.map((j) => ({
        title: String(j.title),
        company: String(j.company),
        at: String(j.at),
      })),
    };
    cached = { data, at: Date.now() };
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch (e) {
    console.error('[stats] GET failed:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { totalApplied: 0, last7d: 0, companies: 0, avgReview: 0, reviewCount: 0, recent: [] },
      { status: 200 }
    );
  }
}
