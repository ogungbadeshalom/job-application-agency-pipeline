import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

async function assertWorkerOwns(
  workerId: string,
  profileId: string
): Promise<boolean> {
  const profile = await db.getProfileByWorker(workerId);
  return !!profile && profile.id === profileId;
}

// GET /api/snippets?profile_id=…  (worker/admin only — clients have no access)
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!['admin', 'worker'].includes(session.user.role)) {
    return NextResponse.json({ snippets: [] });
  }

  const profileId = new URL(req.url).searchParams.get('profile_id');
  if (!profileId) return NextResponse.json({ error: 'profile_id required' }, { status: 400 });

  if (session.user.role === 'worker') {
    if (!(await assertWorkerOwns(session.user.id, profileId)))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const snippets = await db.listSnippets(profileId);
  return NextResponse.json({ snippets });
}

// POST /api/snippets  { profile_id, question, answer }
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !['admin', 'worker'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { profile_id, question, answer } = await req.json().catch(
    () => ({}) as { profile_id?: string; question?: string; answer?: string }
  );
  if (!profile_id || !question || !answer) {
    return NextResponse.json({ error: 'profile_id, question, answer required' }, { status: 400 });
  }
  if (session.user.role === 'worker') {
    if (!(await assertWorkerOwns(session.user.id, profile_id)))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const snippet = await db.createSnippet({ profile_id, question, answer });
  return NextResponse.json({ snippet });
}
