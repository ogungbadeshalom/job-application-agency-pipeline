import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

// Valid accent values, mirrored from the ACCENTS array in AccentSetting.tsx
// and the html[data-accent=...] blocks in globals.css. '' = app default (RED).
const VALID_ACCENTS = new Set(['', 'red', 'green', 'blue', 'purple', 'orange', 'cyan']);

// GET /api/me/accent — the signed-in user's saved accent preference.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ accent: session.user.accent ?? '' });
}

// PUT /api/me/accent  { accent: string } — save the current user's accent.
// Bounds the value to the known palette so a client can't inject arbitrary CSS.
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { accent } = await req.json().catch(() => ({}) as { accent?: unknown });
  if (typeof accent !== 'string' || !VALID_ACCENTS.has(accent)) {
    return NextResponse.json(
      { error: 'accent must be one of: red, green, blue, purple, orange, cyan (or empty)' },
      { status: 400 }
    );
  }

  const user = await db.setAccent(session.user.id, accent);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  return NextResponse.json({ accent: user.accent });
}