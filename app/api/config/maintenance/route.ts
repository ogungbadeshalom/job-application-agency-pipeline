import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

// GET /api/config/maintenance — current maintenance message + enabled state.
export async function GET() {
  const cfg = await db.getAppConfig();
  return NextResponse.json({
    message: cfg?.maintenance_message || '',
    enabled: cfg?.maintenance_enabled || false,
  });
}

// PATCH /api/config/maintenance  { message, enabled } — admin only.
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({} as { message?: string; enabled?: boolean }));
  const message = typeof body.message === 'string' ? body.message : '';
  const enabled = Boolean(body.enabled);
  if (message.length > 2000) {
    return NextResponse.json({ error: 'Message too long (max 2000 chars)' }, { status: 400 });
  }
  const cfg = await db.setMaintenance(message, enabled);
  return NextResponse.json({
    message: cfg.maintenance_message,
    enabled: cfg.maintenance_enabled,
  });
}