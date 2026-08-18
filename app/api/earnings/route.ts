import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

// Earnings pool meter endpoint (admin only).
//
// GET  /api/earnings -> the editable config (private USD-per-app rate, NGN/USD
//      rate, and the visible naira weekly cap).
// PUT  /api/earnings -> body: { usdPerApp, ngnPerUsd, weeklyCapNaira }
export async function GET() {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const cfg = await db.getEarningsConfig();
  return NextResponse.json({
    usdPerApp: cfg.usdPerApp,
    ngnPerUsd: cfg.ngnPerUsd,
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
  const usdPerApp = Number(body.usdPerApp);
  const ngnPerUsd = Number(body.ngnPerUsd);
  const weeklyCapNaira = Number(body.weeklyCapNaira);
  if (
    !Number.isFinite(usdPerApp) ||
    !Number.isFinite(ngnPerUsd) ||
    !Number.isFinite(weeklyCapNaira) ||
    usdPerApp < 0 ||
    ngnPerUsd <= 0 ||
    weeklyCapNaira <= 0
  ) {
    return NextResponse.json({ error: 'Invalid earnings config' }, { status: 400 });
  }
  const res = await db.setEarningsConfig({ usdPerApp, ngnPerUsd, weeklyCapNaira });
  return NextResponse.json(res);
}