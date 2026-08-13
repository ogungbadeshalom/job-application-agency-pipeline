import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import type { Profile } from '@/lib/types';

// GET /api/profiles  — admin: all. worker: own assigned client. client: own.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.user.role === 'admin') {
    const profiles = await db.listProfiles();
    return NextResponse.json({ profiles });
  }
  if (session.user.role === 'worker') {
    const profiles = await db.listProfilesByWorker(session.user.id);
    return NextResponse.json({ profiles });
  }
  if (session.user.profile_id) {
    const profile = await db.getProfile(session.user.profile_id);
    return NextResponse.json({ profiles: profile ? [profile] : [] });
  }
  return NextResponse.json({ profiles: [] });
}

// POST /api/profiles  (admin only) — create a client profile.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Partial<Profile>;
  const profile = await db.createProfile({
    name: body.name,
    email: body.email,
    assigned_worker_id: body.assigned_worker_id,
    scrape_search_terms: body.scrape_search_terms ?? [],
    scrape_location: body.scrape_location ?? 'United States',
    scrape_sites: body.scrape_sites ?? ['indeed'],
  });
  return NextResponse.json({ profile });
}

// PATCH /api/profiles (ADMIN only) — update profile fields (resume text, settings).
// Workers never edit profile-level fields (their resume work is per-job via
// /api/tailor); allowing worker PATCH here was the root of a cross-tenant file
// IDOR (a worker could re-point their profile's base_resume_url at another
// client's file) and lets them reassign ownership / rewrite contact data.
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Partial<Profile> & { id: string };
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const patch: Partial<Profile> = {};
  for (const k of [
    'name',
    'email',
    'assigned_worker_id',
    'base_resume_text',
    'base_resume_url',
    'scrape_search_terms',
    'scrape_location',
    'scrape_sites',
    'scrape_results_wanted',
    'scrape_hours_old',
    'jobs_per_week',
  ]) {
    if (k in body) (patch as Record<string, unknown>)[k] = (body as Record<string, unknown>)[k];
  }

  const profile = await db.updateProfile(body.id, patch);
  return NextResponse.json({ profile });
}
