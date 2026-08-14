import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isUuid } from '@/lib/validate';

// PUT /api/presets/[id] — replace the presets for a profile (admin only).
// Body: { presets: Array<{ id, name, search_terms, sites, location, remote_only, results_wanted }> }
export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isUuid(params.id)) {
    return NextResponse.json({ error: 'Invalid profile id' }, { status: 400 });
  }

  const profile = await db.getProfile(params.id);
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: { presets?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!Array.isArray(body.presets)) {
    return NextResponse.json({ error: 'presets must be an array' }, { status: 400 });
  }
  await db.setProfilePresets(params.id, body.presets as never);
  return NextResponse.json({ ok: true, presets: body.presets });
}