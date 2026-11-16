import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/me/profiles — Hermes seam: list the profiles the signed-in worker
// handles, for the ApplyOS "connect account -> pick profile" flow. Returns the
// profile id, name, allowed roles, resume path, and saved-job count so the app
// can render a picker without the user typing anything.
export async function GET() {
  const session = await getSession();
  if (!session || (session.user.role !== 'worker' && session.user.role !== 'admin')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [profiles, counts] = await Promise.all([
    db.listProfilesByWorker(session.user.id),
    db.savedCountsByWorker(session.user.id),
  ]);

  return NextResponse.json({
    profiles: profiles.map((p) => ({
      client: p.name,
      profile_id: p.id,
      allowed_roles: p.allowed_roles,
      resumePath: p.base_resume_url,
      savedCount: counts[p.id] ?? 0,
    })),
  });
}