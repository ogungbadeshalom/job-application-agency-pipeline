#!/usr/bin/env node
// App-level role access tests against the running app (Postgres-backed).
//
// These verify the role checks in the API layer (lib/auth.ts requireRole + the
// per-route authorization) using real Auth.js credentials sessions against the
// seeded accounts. Run AFTER the DB is migrated + seeded and the dev server is
// up:
//   npm run db:up && npm run db:migrate && npm run db:seed
//   npm run dev
//   node scripts/test-access.mjs

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Node doesn't auto-load .env.local, so pull ADMIN_PASSWORD / BASE_URL from it
// (next's loadEnvConfig does this for the app; this bare-node script needs it
// explicitly). Without it the admin test silently falls back to the seed
// default 'changeme', which fails against any real deployed admin password
// and produces a false "admin sees all jobs" failure.
function loadDotEnv() {
  const p = resolve(process.cwd(), '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    process.env[k] ??= v.replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadDotEnv();

const BASE = process.env.BASE_URL || 'http://localhost:3000';
let pass = 0;
let fail = 0;

// fetch() doesn't persist cookies by default, and Auth.js needs the csrf cookie
// from /api/auth/csrf to accompany the credentials POST. We keep a tiny jar.
let cookieJar = '';

function appendCookies(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of set) {
    const name = c.split('=')[0];
    cookieJar = cookieJar
      .split('; ')
      .filter((kv) => !kv.startsWith(`${name}=`) && kv.trim() !== '')
      .join('; ');
    const kv = c.split(';')[0];
    cookieJar = cookieJar ? `${cookieJar}; ${kv}` : kv;
  }
}

async function csrfStep() {
  const res = await fetch(`${BASE}/api/auth/csrf`, { method: 'GET' });
  cookieJar = '';
  appendCookies(res);
  return (await res.json()).csrfToken;
}

async function loginAs(email, password = 'changeme') {
  const token = await csrfStep();
  const body = new URLSearchParams({
    csrfToken: token,
    email,
    password,
    callbackUrl: `${BASE}/`,
    json: 'true',
  });
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookieJar },
    body: body.toString(),
    redirect: 'manual',
  });
  appendCookies(res);
  // Return the session cookie (authjs.session-token) if set.
  const sessions = cookieJar.split('; ').filter((kv) => kv.startsWith('authjs.session-token='));
  return sessions.length ? sessions[0] : '';
}

async function api(path, cookie, opts = {}) {
  return fetch(`${BASE}${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) },
  });
}

async function check(name, cond) {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}`); }
}

async function main() {
  console.log(`Testing role access against ${BASE} …\n`);

  // Admin can see all jobs.
  let admin = await loginAs('admin@jobbidder.com', process.env.ADMIN_PASSWORD || 'changeme');
  let res = await api('/api/jobs', admin);
  let body = await res.json();
  await check('admin sees all jobs (200 + array)', res.ok && Array.isArray(body.jobs));

  // Worker cannot access admin-only endpoint.
  const worker = await loginAs('worker1@jobbidder.com');
  res = await api('/api/users', worker);
  await check('worker forbidden from /api/users (401)', res.status === 401);

  // Unauthenticated is rejected.
  res = await api('/api/jobs', '');
  await check('no auth rejected (401)', res.status === 401);

  // Unknown creds rejected at login.
  const bad = await loginAs('admin@jobbidder.com', 'wrong-password');
  await check('bad password cannot log in', bad === '');

  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error('Access test error:', e.message);
  console.error('Is the dev server running with a migrated+seeded DB?');
  process.exit(1);
});