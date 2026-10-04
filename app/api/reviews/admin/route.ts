import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/db/pool';

// Admin-only review moderation.
// GET    /api/reviews/admin  — all reviews (pending first)
// PATCH  /api/reviews/admin  — { id, status?, featured? }
async function requireAdmin() {
  const session = await getSession();
  if (!session?.user || session.user.role !== 'admin') return null;
  return session;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const rows = await query(
    `select id, user_id, name, role_label, stars, rating_communication, rating_speed, rating_results,
            body, status, verified, featured, created_at, moderated_at
     from reviews
     order by case when status = 'pending' then 0 else 1 end, created_at desc
     limit 200`
  );
  const reviews = rows.rows.map((r) => ({
    id: String(r.id),
    userId: r.user_id ? String(r.user_id) : null,
    name: String(r.name),
    roleLabel: r.role_label ? String(r.role_label) : null,
    stars: Number(r.stars),
    ratingCommunication: r.rating_communication != null ? Number(r.rating_communication) : null,
    ratingSpeed: r.rating_speed != null ? Number(r.rating_speed) : null,
    ratingResults: r.rating_results != null ? Number(r.rating_results) : null,
    body: String(r.body),
    status: String(r.status),
    verified: Boolean(r.verified),
    featured: Boolean(r.featured),
    createdAt: String(r.created_at),
  }));
  const pending = reviews.filter((r) => r.status === 'pending').length;
  return NextResponse.json({ reviews, pending });
}

export async function PATCH(req: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === 'string' ? body.id : '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Valid review id required.' }, { status: 400 });
  }

  const sets = new Map<string, unknown>();
  sets.set('moderated_at = now()', null);
  let statusVal: string | null = null;
  if (body.status === 'approved' || body.status === 'rejected' || body.status === 'pending') {
    statusVal = body.status;
  }
  if (typeof body.featured === 'boolean') {
    sets.set('featured = $K', body.featured);
    // Only approved reviews can be featured.
    if (body.featured) statusVal = 'approved';
  }
  if (statusVal) sets.set('status = $K', statusVal);
  if (typeof body.body === 'string' && body.body.trim()) {
    sets.set('body = $K', body.body.trim().slice(0, 1500));
  }
  sets.set('id = $K', id);

  // Bind placeholders in stable order; each $K becomes $1..$n by insertion order.
  const keys = Array.from(sets.keys());
  const vals: unknown[] = [];
  let i = 0;
  const setSql = keys
    .map((k) => {
      const v = sets.get(k);
      if (v === null && k === 'moderated_at = now()') return k; // literal now()
      i += 1;
      vals.push(v);
      return k.replace('$K', `$${i}`);
    })
    .join(', ');
  const idParam = `$${i}`;

  const res = await query(`update reviews set ${setSql} where id = ${idParam} returning id`, vals);
  if (!res.rows.length) return NextResponse.json({ error: 'Review not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Valid review id required.' }, { status: 400 });
  }
  await query('delete from reviews where id = $1::uuid', [id]);
  return NextResponse.json({ ok: true });
}
