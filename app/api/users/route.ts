import { NextResponse } from 'next/server';
import { hash } from 'bcryptjs';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import type { Role, Profile } from '@/lib/types';

// GET /api/users  (admin) — list accounts.
export async function GET() {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const users = await db.listUsers();
  return NextResponse.json({ users });
}

// POST /api/users  (admin) — create a user (worker or client).
// Body:
//   { email, password, role: 'worker'|'client', full_name,
//     profileName?,                     // if client: creates a profile
//     assigned_worker_id? }            // if client: link to a worker
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    role?: Role;
    full_name?: string;
    profileName?: string;
    profileId?: string;
    assigned_worker_id?: string | null;
  };

  if (!body.email || !body.password || !body.role) {
    return NextResponse.json(
      { error: 'email, password and role are required' },
      { status: 400 }
    );
  }
  if (!['worker', 'client'].includes(body.role)) {
    return NextResponse.json({ error: 'role must be worker or client' }, { status: 400 });
  }

  // Email uniqueness.
  if (await db.getUserByEmail(body.email)) {
    return NextResponse.json({ error: 'A user with that email already exists' }, { status: 409 });
  }

  const passwordHash = await hash(body.password, 10);
  let profileId: string | null = body.profileId ?? null;

  // Clients get a profile (auto-create unless profileId given).
  if (body.role === 'client' && !profileId) {
    const profile = await db.createProfile({
      name: body.profileName || body.full_name || body.email,
      email: body.email,
      assigned_worker_id: body.assigned_worker_id ?? null,
    } as Partial<Profile>);
    profileId = profile.id;
  }

  const user = await db.createUser({
    email: body.email,
    role: body.role,
    full_name: body.full_name || '',
    password_hash: passwordHash,
    profile_id: profileId,
  });

  return NextResponse.json({ user }, { status: 201 });
}

// PATCH /api/users  (admin) — reset password / rename.
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    password?: string;
    full_name?: string;
    email?: string;
  };
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const existing = await db.getUser(body.id);
  if (!existing) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // If the email is changing, ensure it isn't taken by another account.
  if (body.email && body.email.toLowerCase() !== existing.email.toLowerCase()) {
    const clash = await db.getUserByEmail(body.email);
    if (clash && clash.id !== body.id) {
      return NextResponse.json({ error: 'A user with that email already exists' }, { status: 409 });
    }
  }

  const patch: { password_hash?: string; full_name?: string; email?: string } = {};
  if (body.password) patch.password_hash = await hash(body.password, 10);
  if (body.full_name) patch.full_name = body.full_name;
  if (body.email) patch.email = body.email;

  const updated = await db.updateUser(body.id, patch);
  return NextResponse.json({ user: updated });
}