import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

// Earnings pool meter endpoint.
//
// GET  /api/earnings (admin) -> the editable config (incl. the private per-app
//      rate) + aggregate. Workers never hit this for their own numbers — their
//      weekly naira is computed server-side in /worker/queue and the rate is
//      never exposed there either.
// PUT  /api/earnings (admin only)
//      body: { perAppNaira: number, weeklyCapNaira: number }
export async function GET() {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const cfg = await db.getEarningsConfig();
  return NextResponse.json({
    perAppNaira: cfg.perAppNaira,
    weeklyCapNaira: cfg.weeklyCapNaira,
    updatedAt: cfg.updatedAt,
  });
}

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const perAppNaira = Number(body.perAppNaira);
  const weeklyCapNaira = Number(body.weeklyCapNaira);
  if (
    !Number.isFinite(perAppNaira) ||
    !Number.isFinite(weeklyCapNaira) ||
    perAppNaira < 0 ||
    weeklyCapNaira <= 0
  ) {
    return NextResponse.json({ error: 'Invalid earnings config' }, { status: 400 });
  }
  const res = await db.setEarningsConfig({ perAppNaira, weeklyCapNaira });
  return NextResponse.json(res);
}