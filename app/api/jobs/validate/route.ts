import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { fetchPageMeta } from '@/lib/pageMeta';

export const dynamic = 'force-dynamic';

interface BoardHit { pattern: RegExp; board: string; }
const BOARDS: BoardHit[] = [
  { pattern: /greenhouse|job-boards\.greenhouse\.io/i, board: 'greenhouse' },
  { pattern: /jobs\.lever\.co|lever\.co/i, board: 'lever' },
  { pattern: /ashbyhq\.com/i, board: 'ashby' },
  { pattern: /careers\.toasttab\.com|toasttab/i, board: 'toasttab' },
  { pattern: /workable\.com/i, board: 'workable' },
  { pattern: /smartrecruiters\.com/i, board: 'smartrecruiters' },
  { pattern: /bamboohr\.com/i, board: 'bamboohr' },
  { pattern: /breezy\.hr/i, board: 'breezy' },
  { pattern: /indeed\.com/i, board: 'indeed' },
  { pattern: /linkedin\.com\/jobs/i, board: 'linkedin' },
  { pattern: /ziprecruiter/i, board: 'ziprecruiter' },
];

function detectBoard(url: string): string {
  for (const b of BOARDS) if (b.pattern.test(url)) return b.board;
  return 'other'; // unknown board — still attempt, but flag it
}

// POST /api/jobs/validate — Hermes seam: pre-flight a job URL before the app
// spends time/tokens filling it. Returns whether it's currently live + which
// board it belongs to, so the drain loop skips dead postings up front.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* noop */ }
  let rawUrl = typeof body.url === 'string' ? body.url.trim() : '';

  if (!/^https?:\/\//i.test(rawUrl)) rawUrl = rawUrl ? `https://${rawUrl}` : '';
  if (!/^https?:\/\/[^\s]+$/i.test(rawUrl) || !rawUrl.includes('.')) {
    return NextResponse.json({ error: 'Enter a valid job posting URL.' }, { status: 422 });
  }

  const board = detectBoard(rawUrl);
  const meta = await fetchPageMeta(rawUrl);
  // Live = we successfully fetched a real page title. A 404/dead board yields
  // empty meta (fetchPageMeta returns empty on !res.ok), so live=false.
  const live = Boolean(meta.title);

  return NextResponse.json({
    live,
    board,
    url: rawUrl,
    title: meta.title || null,
    company: meta.company || null,
    note: live ? 'ok' : 'dead or unverifiable — skipping',
  });
}