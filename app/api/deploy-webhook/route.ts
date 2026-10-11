import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';

// Auto-deploy webhook receiver.
// GitHub POSTs here on push to main. We verify the shared secret, then launch
// the rebuild script in the background and return 200 immediately (so GitHub
// doesn't time out the webhook). The script pulls + rebuilds + restarts pm2.
export const runtime = 'nodejs';

function verifyHmac(payload: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const crypto = require('node:crypto');
  const expected = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  const received = signature.toLowerCase();
  // Accept both "sha256=..." (hub standard) and the bare hex.
  const got = received.startsWith('sha256=') ? received.slice(7) : received;
  if (expected.length !== got.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got));
}

function isMainBranch(body: any): boolean {
  const ref: string | undefined = body?.ref;
  if (!ref) return false;
  return ref === 'refs/heads/main' || ref === 'refs/heads/master';
}

export async function POST(req: Request) {
  const secret = process.env.DEPLOY_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'WEBHOOK_SECRET_NOT_SET' }, { status: 500 });
  }

  const raw = await req.text();
  const sig = req.headers.get('x-hub-signature-256') || req.headers.get('x-hub-signature');

  if (!verifyHmac(raw, sig, secret)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  // Only auto-deploy on branch pushes (ignore PRs, tags, ping).
  const event = req.headers.get('x-github-event') || 'push';
  if (event === 'ping') {
    return NextResponse.json({ ok: true, pong: true });
  }
  let body: any = {};
  try { body = JSON.parse(raw); } catch { /* ignore */ }
  if (event !== 'push' || !isMainBranch(body)) {
    return NextResponse.json({ ok: true, ignored: 'not a main-branch push' });
  }

  // Fire the deploy script in the background; don't block the webhook ack.
  const child = spawn('/root/auto_deploy.sh', [], { detached: true, stdio: 'ignore' });
  child.unref();

  return NextResponse.json({ ok: true, deploying: true });
}