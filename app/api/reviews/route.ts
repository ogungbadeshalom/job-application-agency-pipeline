import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/db/pool';

// GET /api/reviews — public: approved reviews for the landing page.
// (Admin list + moderation lives in /api/reviews/admin.)
export async function GET() {
  try {
    const rows = await query(
      `select id, name, role_label, stars, rating_communication, rating_speed, rating_results,
              body, verified, featured, created_at
       from reviews
       where status = 'approved'
       order by featured desc, created_at desc
       limit 60`
    );
    const reviews = rows.rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      roleLabel: r.role_label ? String(r.role_label) : null,
      stars: Number(r.stars),
      ratingCommunication: r.rating_communication != null ? Number(r.rating_communication) : null,
      ratingSpeed: r.rating_speed != null ? Number(r.rating_speed) : null,
      ratingResults: r.rating_results != null ? Number(r.rating_results) : null,
      body: String(r.body),
      verified: Boolean(r.verified),
      featured: Boolean(r.featured),
      createdAt: String(r.created_at),
    }));
    const total = reviews.length;
    const avg = total ? reviews.reduce((a, r) => a + r.stars, 0) / total : 0;
    return NextResponse.json({ reviews, avg: Math.round(avg * 10) / 10, total });
  } catch (e) {
    console.error('[reviews] GET failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ reviews: [], avg: 0, total: 0 }, { status: 200 });
  }
}

// POST /api/reviews — submit a review.
//  - Logged-in users: verified=true automatically (proven app usage), still pending admin approval.
//  - Anonymous (external past clients): verified=false, pending admin approval.
export async function POST(req: Request) {
  const session = await getSession();
  const body = await req.json().catch(() => ({}));

  // Honeypot: bots fill every field. Real users never touch 'website'.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return NextResponse.json({ ok: true }, { status: 200 }); // pretend success
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  const roleLabel = typeof body.roleLabel === 'string' ? body.roleLabel.trim().slice(0, 80) : null;
  const text = typeof body.body === 'string' ? body.body.trim().slice(0, 1500) : '';
  const stars = Number(body.stars);
  const cat = (v: unknown) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  };

  if (!text || text.length < 10) {
    return NextResponse.json({ error: 'Review text is too short.' }, { status: 400 });
  }
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return NextResponse.json({ error: 'Star rating (1-5) is required.' }, { status: 400 });
  }

  const userId = session?.user?.id ?? null;
  let verified = false;
  let finalName = name;
  let finalRole = roleLabel;

  if (session?.user) {
    verified = true;
    if (!finalName) finalName = session.user.email?.split('@')[0] || 'Client';
    if (!finalRole) finalRole = session.user.role === 'client' ? 'Client' : session.user.role === 'worker' ? 'Team' : 'Staff';
  }

  if (!finalName) {
    return NextResponse.json({ error: 'Your name is required.' }, { status: 400 });
  }

  // Light rate limit: max 5 reviews per identity (user or name+text hash) per day.
  const rl = await query(
    `select count(*) as n from reviews
     where created_at > now() - interval '24 hours'
       and (user_id = $1::uuid or ($1::uuid is null and name = $2))`,
    [userId, finalName]
  );
  if (Number(rl.rows[0]?.n ?? 0) >= 5) {
    return NextResponse.json({ error: 'Too many reviews submitted today. Try again later.' }, { status: 429 });
  }

  await query(
    `insert into reviews (user_id, name, role_label, stars, rating_communication, rating_speed, rating_results, body, status, verified)
     values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)`,
    [userId, finalName, finalRole, stars, cat(body.ratingCommunication), cat(body.ratingSpeed), cat(body.ratingResults), text, verified]
  );

  return NextResponse.json({ ok: true, verified }, { status: 201 });
}
