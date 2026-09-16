import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getWorkerIdFromProofToken } from '@/lib/proofAuth';

// GET /api/proof/jobs  (Bearer worker proof-token)
// Returns the worker's assignable jobs (saved+tailored) so the extension's job
// picker (Option B) has real titles/companies to attach a proof to. Slim fields
// only — the picker needs id/title/company/board, not descriptions.
export async function GET(req: Request) {
  const workerId = await getWorkerIdFromProofToken(req);
  if (!workerId) {
    return NextResponse.json({ error: 'Invalid or missing token' }, { status: 401 });
  }

  const profiles = await db.listProfilesByWorker(workerId);
  if (!profiles.length) {
    return NextResponse.json({ jobs: [] });
  }
  const profileIds = profiles.map((p) => p.id);

  const jobs = await db.listJobsSlim({
    profile_ids: profileIds,
    status: ['saved', 'tailored'],
    limit: 500,
  });

  // Return only the fields the picker needs.
  return NextResponse.json({
    jobs: jobs.map((j) => ({
      id: j.id,
      title: j.title,
      company: j.company,
      board: j.board,
      status: j.status,
      profile_id: j.profile_id,
    })),
  });
}