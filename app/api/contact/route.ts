import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

// POST /api/contact — public "Start your campaign" form (public/contact.html).
// Delivers the lead to the operator inbox over Gmail SMTP (app password in
// .env.local: GMAIL_USER / GMAIL_APP_PASSWORD). Port 587 — 465 is blocked
// outbound on this box.
const TO = process.env.GMAIL_USER || 'badeshalom@gmail.com';

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim();
  const roles = String(body.roles ?? '').trim();
  const location = String(body.location ?? '').trim();
  const volume = String(body.volume ?? '').trim();
  const message = String(body.message ?? '').trim();

  if (!name || !email || !roles) {
    return NextResponse.json({ error: 'Name, email, and target roles are required.' }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Please provide a valid email address.' }, { status: 400 });
  }

  const pass = process.env.GMAIL_APP_PASSWORD;
  const user = process.env.GMAIL_USER;
  if (!pass || !user) {
    console.error('[contact] SMTP credentials missing');
    return NextResponse.json({ error: 'Contact form is temporarily unavailable. Email us directly.' }, { status: 500 });
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user, pass },
  });

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows: [string, string][] = [
    ['Name', name],
    ['Email', email],
    ['Target roles', roles],
    ['Location / remote', location || '—'],
    ['Volume considered', volume || '—'],
    ['Message', message || '—'],
  ];
  const html = `<div style="font-family:Arial,sans-serif; font-size:14px; color:#111">
    <h2 style="margin:0 0 12px;">New Pitchr contact-form lead</h2>
    <table cellpadding="6" style="border-collapse:collapse">${rows.map(([k, v]) =>
      `<tr><td style="font-weight:bold; padding-right:12px; vertical-align:top;">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}
    </table></div>`;
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');

  try {
    await transporter.sendMail({
      from: `"Pitchr website" <${user}>`,
      to: TO,
      replyTo: email,
      subject: `Pitchr lead: ${name} — ${roles.slice(0, 60)}`,
      text,
      html,
    });
  } catch (e) {
    console.error('[contact] send failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Could not send your message right now. Please email us directly.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
