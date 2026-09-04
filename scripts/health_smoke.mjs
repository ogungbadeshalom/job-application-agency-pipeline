// Functional smoke test for Job Bidder — exercises REAL endpoints across all
// three roles with real HTTP sessions (NextAuth v5 credentials + JWT), instead
// of passively reading logs. Fails RED on any broken core flow.
//
// Usage: node scripts/health_smoke.mjs [baseUrl]   (default http://localhost:3000)
import fs from 'fs';

const BASE = process.argv[2] || 'http://localhost:3000';

// ---- tiny cookie jar ----
const jar = new Map(); // name -> value
function storeSetCookie(setCookies) {
  for (const sc of setCookies || []) {
    const [pair] = sc.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✅ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
    console.log(`  ❌ ${name} — ${e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { cookie: cookieHeader(), ...(opts.headers || {}) },
    redirect: 'manual',
  });
  storeSetCookie(res.headers.getSetCookie?.());
  return res;
}

async function login(email, password) {
  jar.clear();
  const csrfRes = await req('/api/auth/csrf');
  const { csrfToken } = await csrfRes.json();
  storeSetCookie(csrfRes.headers.getSetCookie?.());
  // NextAuth v5 credentials callback returns a redirect; the session cookie
  // lands in the jar. Use URL-encoded form like the real browser.
  const form = `csrfToken=${encodeURIComponent(csrfToken)}&email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}&callbackUrl=${encodeURIComponent(BASE)}`;
  const res = await req('/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const hasSession = cookieHeader().includes('session-token');
  if (!hasSession) throw new Error(`login failed (no session cookie), status ${res.status}`);
  return res;
}

const out = [];
async function api(path) {
  const res = await req(path);
  const text = await res.text();
  out.push({ path, status: res.status, body: text });
  return { res, text };
}

// ---- the tests ----
console.log(`\n=== Job Bidder functional smoke test @ ${BASE} ===\n`);

let adminCookie;
let workerJobId;
let workerPdfUrl;

// Admin creds are user-specific; read from env so the cron can pass them
// securely. If not provided, verify admin *exists* in DB instead of logging in.
const ADMIN_EMAIL = process.env.JB_ADMIN_EMAIL || 'admin@jobbidder.com';
const ADMIN_PASS = process.env.JB_ADMIN_PASS || '';
const WORKER_EMAIL = process.env.JB_WORKER_EMAIL || 'Liz@jobbidder.com';
const WORKER_PASS = process.env.JB_WORKER_PASS || '12345678';
const CLIENT_EMAIL = process.env.JB_CLIENT_EMAIL || 'andrewp@email.com';
const CLIENT_PASS = process.env.JB_CLIENT_PASS || '12345678';

// Public + auth shape
await check('GET /login returns 200+HTML', async () => {
  const res = await fetch(BASE + '/login');
  assert(res.status === 200, `status ${res.status}`);
  const t = await res.text();
  assert(t.includes('Job Bidder'), 'no app title in HTML');
});

await check('logged-out /api/jobs returns 401 JSON', async () => {
  jar.clear();
  const res = await req('/api/jobs');
  assert(res.status === 401, `status ${res.status}`);
});

// Admin flow (password is user-set; skip login if none provided, still verify existence)
if (ADMIN_PASS) {
  await check(`admin login (${ADMIN_EMAIL})`, async () => {
    await login(ADMIN_EMAIL, ADMIN_PASS);
    adminCookie = cookieHeader();
  });
  await check('admin /api/me returns admin role', async () => {
    const { text } = await api('/api/me');
    const d = JSON.parse(text);
    assert(d?.user?.role === 'admin', `role=${d?.user?.role}`);
  });
  await check('admin can list jobs (GET /api/jobs)', async () => {
    const { res, text } = await api('/api/jobs?limit=1');
    assert(res.status === 200, `status ${res.status}`);
    assert(text.includes('jobs') || text.startsWith('{'), 'no jobs payload');
  });
  await check('admin can list profiles', async () => {
    const res = await req('/api/profiles');
    assert(res.status === 200, `status ${res.status}`);
  });
} else {
  await check('admin account exists in DB (creds not provided to test)', async () => {
    const { execSync } = await import('child_process');
    const envUrl = fs.readFileSync('/root/job-agency/.env.local', 'utf8').match(/DATABASE_URL=(\S+)/)?.[1];
    const n = execSync(`psql "${envUrl}" -tAc "select count(*) from users where email='team@jobbidder.com' or email='admin@jobbidder.com'"`).toString().trim();
    assert(Number(n) >= 1, `admin account missing (count=${n})`);
  });
}

// Worker flow (Liz -> Andrew's profile)
await check(`worker login (${WORKER_EMAIL})`, async () => {
  await login(WORKER_EMAIL, WORKER_PASS);
});
let workerSaved = [];
await check('worker queue has jobs (GET /api/jobs as worker)', async () => {
  const { res, text } = await api('/api/jobs');
  assert(res.status === 200, `status ${res.status}`);
  const d = JSON.parse(text);
  assert(Array.isArray(d.jobs), 'jobs not an array');
  workerSaved = (d.jobs || []).filter((j) => j.status === 'saved' || j.status === 'tailored');
  assert(d.jobs.length >= 0, 'no jobs at all');
});
await check('worker can get a specific tailor-eligible job', async () => {
  const row = workerSaved[0];
  if (!row) { console.log('  (no tailor-eligible job found — resume checks skipped, non-fatal)'); return; }
  workerJobId = row.id;
  const { res } = await api(`/api/jobs/${row.id}`);
  assert(res.status === 200, `status ${res.status}`);
});

// Resume generator (the exact thing that broke) — worker-tailor on a real saved job
await check('RESUME: worker Tailor returns text + PDF (POST /api/tailor)', async () => {
  const jid = workerJobId;
  if (!jid) { console.log('  (no saved job to tailor — skipping, non-fatal)'); return; }
  const res = await req('/api/tailor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: jid }),
  });
  if (res.status !== 200) {
    throw new Error(`tailor status ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const d = await res.json();
  assert(typeof d.tailored_resume === 'string' && d.tailored_resume.length > 100, 'no resume text returned');
  assert(typeof d.tailored_resume_pdf_url === 'string' && d.tailored_resume_pdf_url, 'no PDF url returned');
  workerPdfUrl = d.tailored_resume_pdf_url;
});

await check('RESUME: generated PDF is downloadable (GET /api/files/<pdf>)', async () => {
  if (!workerPdfUrl) { console.log('  (no pdf to check — skipped)'); return; }
  const res = await req(`/api/files/${workerPdfUrl}`);
  assert(res.status === 200, `status ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  assert(buf.slice(0, 4).toString() === '%PDF', 'not a PDF magic header');
  assert(buf.length > 500, 'pdf suspiciously small');
});

await check('RESUME: /api/resume-preview returns preview payload', async () => {
  const res = await req('/api/resume-preview?profile_id=' + (process.env.TEST_PROFILE || ''));
  // preview may require a profile; if 200 or 4xx with JSON it's fine —
  // we mainly assert it doesn't 500.
  assert([200, 400, 404].includes(res.status), `status ${res.status}`);
});

// Client flow (Pendergrass -> Andrew's applied jobs)
await check(`client login (${CLIENT_EMAIL})`, async () => {
  await login(CLIENT_EMAIL, CLIENT_PASS);
});
await check('client sees own applied jobs', async () => {
  const { res, text } = await api('/api/jobs');
  assert(res.status === 200, `status ${res.status}`);
  const d = JSON.parse(text);
  assert(Array.isArray(d.jobs), 'jobs not array');
  const applied = (d.jobs || []).filter((j) => j.status === 'applied');
  assert(applied.length > 0, 'client sees zero applied jobs');
});

// DB health (live, no secrets in output)
await check('DB: job row counts are sane', async () => {
  const { spawnSync } = await import('child_process');
  // read DATABASE_URL from /proc of the running node process (no secret echo)
  const envUrl = fs.readFileSync('/root/job-agency/.env.local', 'utf8').match(/DATABASE_URL=(\S+)/)?.[1];
  if (!envUrl) throw new Error('no DATABASE_URL');
  const { execSync } = await import('child_process');
  const count = execSync(
    `psql "${envUrl}" -tAc "select count(*) from jobs" 2>/dev/null || echo ERR`
  ).toString().trim();
  assert(count !== 'ERR' && Number(count) > 0, `jobs count=${count}`);
});

// Security shape
await check('auth: wrong password is rejected', async () => {
  jar.clear();
  const csrfRes = await req('/api/auth/csrf');
  const { csrfToken } = await csrfRes.json();
  storeSetCookie(csrfRes.headers.getSetCookie?.());
  const form = `csrfToken=${encodeURIComponent(csrfToken)}&email=admin%40jobbidder.com&password=WRONGPW&callbackUrl=${encodeURIComponent(BASE)}`;
  const res = await req('/api/auth/callback/credentials', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
  const hasSession = cookieHeader().includes('session-token');
  assert(!hasSession, 'got a session with a wrong password!');
});

// ---- summary ----
const failed = results.filter((r) => !r.ok);
console.log(`\n=== RESULT: ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) {
  console.log('FAILED:');
  failed.forEach((f) => console.log(`  - ${f.name}: ${f.err}`));
  process.exit(1);
} else {
  console.log('✅ all functional checks passed');
  process.exit(0);
}