import { NextResponse } from 'next/server';
import { get } from 'https';
import { query } from '@/db/pool';
import { genLicenseKey, matchNgnProduct } from '@/lib/applyos';

// POST /api/flutterwave/webhook — ApplyOS Nigeria licensing.
// Flutterwave sends charge.completed; we VERIFY the transaction against the
// v3 API (never trust the payload) before issuing/extending anything.
// Requires env: FLW_SECRET_KEY, FLW_WEBHOOK_HASH (set in .env.local).
// Until both are set this route returns 503 — dormant but deployed.

function flwGet(path: string): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = get(
      `https://api.flutterwave.com${path}`,
      { headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY || ''}` } },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try { resolve({ statusCode: res.statusCode || 500, body: JSON.parse(raw) }); }
          catch { reject(new Error('bad flw response')); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('flw timeout')); });
  });
}

async function emailKey(to: string, key: string, plan: string) {
  // Uses the agency Gmail SMTP creds from /root/outreach/.env (loaded by env setup).
  try {
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 587, secure: false,
      auth: { user: process.env.APPLYOS_GMAIL_USER, pass: process.env.APPLYOS_GMAIL_PASS },
    });
    await transport.sendMail({
      from: 'ApplyOS <' + process.env.APPLYOS_GMAIL_USER + '>',
      to,
      subject: `Your ApplyOS ${plan} license key`,
      text: `Welcome to ApplyOS!\n\nYour ${plan} license key:\n\n    ${key}\n\nPaste it in the app under License. It binds to up to 2 computers.\nQuestions? Just reply to this email.`,
    });
  } catch (e) {
    console.error('[applyos/flw] email failed (key still issued):', (e as Error).message);
  }
}

export async function POST(req: Request) {
  if (!process.env.FLW_SECRET_KEY || !process.env.FLW_WEBHOOK_HASH) {
    return NextResponse.json({ error: 'flutterwave not configured' }, { status: 503 });
  }
  // Signature check — Flutterwave sends the hash we configured on their dashboard.
  if (req.headers.get('verif-hash') !== process.env.FLW_WEBHOOK_HASH) {
    return NextResponse.json({ error: 'forbidden' }, { status: 401 });
  }

  const event = await req.json().catch(() => ({} as any));
  if (event['event'] !== 'charge.completed' || event?.data?.status !== 'successful') {
    return NextResponse.json({ received: true });
  }

  const txId = String(event.data.id || '');
  const buyerEmail = String(event.data.customer?.email || '');

  // Verify server-side.
  let verified: any;
  try {
    const r = await flwGet(`/v3/transactions/${txId}/verify`);
    verified = r.body?.data;
    if (!verified || verified.status !== 'successful') {
      return NextResponse.json({ error: 'verification failed' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: `verify error: ${(e as Error).message}` }, { status: 502 });
  }

  const amount = Number(verified.amount);            // NGN major units
  const product = matchNgnProduct(amount);
  if (!product) {
    return NextResponse.json({ received: true, note: `unmatched amount ${amount}` });
  }

  // Find or create the buyer's license.
  let lic = (await query<{ id: string }>('select id from applyos_licenses where email = $1 order by created_at desc limit 1', [buyerEmail])).rows[0];
  if (!lic) {
    const key = genLicenseKey();
    await query(
      `insert into applyos_licenses (id, email, plan, cycle_days, expires_at, tailor_quota, meter_reset_at, features)
       values ($1,$2,'trial',3, now() + interval '3 days', $3, 5, now() + interval '3 days')`,
      [key, buyerEmail, JSON.stringify({ mailbox: true, japaFilters: false, parallel: false })]
    );
    lic = { id: key };
  }

  if (product.kind === 'plan') {
    const tier = product.plan!;
    const days = tier === 'starter' ? 7 : 30;
    const expires = new Date(Date.now() + days * 86400000).toISOString();
    await query(
      `update applyos_licenses
         set plan=$2, cycle_days=$3, expires_at=$4, tailor_quota=$5, tailor_used=0,
             meter_reset_at=$4, flw_tx_id=$6, disabled=false
       where id=$1`,
      [lic.id, tier, days, expires, 100, txId]
    );
    if (tier === 'japa') {
      await query(`update applyos_licenses set tailor_quota=60, features=$2 where id=$1`,
        [lic.id, JSON.stringify({ mailbox: true, japaFilters: true, parallel: true })]);
    }
    await emailKey(buyerEmail, lic.id, tier);
    return NextResponse.json({ ok: true, issued: lic.id, plan: tier });
  }

  // Credits pack.
  await query(
    `insert into applyos_credits (license_id, apps_total, apps_remaining, flw_tx_id, expires_at)
     values ($1,$2,$3,$4, now() + interval '6 months')`,
    [lic.id, product.apps, product.apps, txId]
  );
  await emailKey(buyerEmail, lic.id, 'credit pack');
  return NextResponse.json({ ok: true, creditsAdded: product.apps });
}
