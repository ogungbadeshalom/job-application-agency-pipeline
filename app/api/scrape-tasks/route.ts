import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isUuid } from '@/lib/validate';

// Boards the laptop/residential agent is meant to run — the ones this DC IP
// cannot reach well (Indeed/Glassdoor/ZipRecruiter bot-wall; LinkedIn detail).
const AGENT_BOARDS = ['indeed', 'glassdoor', 'zip_recruiter', 'linkedin', 'remoteok'];

// GET /api/scrape-tasks — admin: list recent tasks + show agent token status.
// POST /api/scrape-tasks — admin: queue a remote-only scrape task for the
//   laptop/residential agent to pull (boards the DC IP can't reach).
export async function GET() {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const [tasks, token] = await Promise.all([
    db.listScrapeTasks(30),
    db.getScrapeAgentToken(),
  ]);
  return NextResponse.json({ tasks, agentTokenSet: Boolean(token) });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({} as {
    profileId?: string; sites?: string[]; searchTerms?: string[]; location?: string; resultsWanted?: number; hoursOld?: number;
  }));
  const profileId = typeof body.profileId === 'string' ? body.profileId : '';
  if (!profileId || !isUuid(profileId)) {
    return NextResponse.json({ error: 'Select a profile.' }, { status: 400 });
  }
  // Only enqueue boards the agent is meant to run (residential-unlockable).
  const rawRequested: unknown = body.sites;
  const requested: string[] = Array.isArray(rawRequested)
    ? rawRequested.filter((x): x is string => typeof x === 'string')
    : [];
  const sites = requested.filter((s) => AGENT_BOARDS.includes(s));
  if (!sites.length) {
    return NextResponse.json({ error: 'Pick at least one board.' }, { status: 400 });
  }
  const rawTerms: unknown = body.searchTerms;
  const terms = Array.isArray(rawTerms) && rawTerms.length
    ? rawTerms.filter((s): s is string => typeof s === 'string').slice(0, 12)
    : ['software engineer'];
  const task = await db.enqueueScrapeTask({
    profileId,
    sites,
    searchTerms: terms,
    location: typeof body.location === 'string' ? body.location : 'Remote',
    resultsWanted: typeof body.resultsWanted === 'number' ? body.resultsWanted : 80,
    hoursOld: typeof body.hoursOld === 'number' ? body.hoursOld : 168,
  });
  return NextResponse.json({ task, message: 'Task queued — the laptop agent will pick it up while on.' }, { status: 202 });
}

// POST /api/scrape-tasks/token — admin: rotate the agent token.
export async function PATCH() {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const token = (globalThis.crypto?.randomUUID?.() ?? `ag_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '');
  await db.setScrapeAgentToken(`ag_${token}`);
  return NextResponse.json({ message: 'Agent token rotated — copy it into the laptop agent config now.' });
}