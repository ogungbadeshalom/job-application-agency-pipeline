// Verify /client/history pagination: login as joseph, fetch the page, count job chips.
const BASE = 'http://localhost:3000';

async function main() {
  // 1. Get CSRF token
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const { csrfToken } = await csrfRes.json();
  const cookie = (csrfRes.headers.get('set-cookie') || '')
    .split(';')[0];

  // 2. Sign in via credentials callback
  const form = new URLSearchParams({
    email: 'joseph@gmail.com',
    password: '12345678',
    csrfToken,
    callbackUrl: `${BASE}/client/history`,
    json: 'true',
  });
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookie,
    },
    body: form.toString(),
    redirect: 'manual',
  });
  const setCookies = loginRes.headers.getSetCookie?.() || [];
  const sessionCookie = setCookies
    .map((c) => c.split(';')[0])
    .filter((c) => c.startsWith('authjs.session-token'))
    .join('; ');
  if (!sessionCookie) {
    console.log('LOGIN_FAILED status=' + loginRes.status);
    console.log('cookies:', setCookies);
    process.exit(1);
  }
  console.log('LOGIN_OK');

  // 3. Fetch the history page
  const pageRes = await fetch(`${BASE}/client/history`, {
    headers: { Cookie: `${cookie}; ${sessionCookie}` },
  });
  const html = await pageRes.text();
  console.log('PAGE_STATUS=' + pageRes.status);

  // Job chips render as <span class="text-xs px-2 py-0.5 rounded bg-navy-800...">
  const chipCount = (html.match(/bg-navy-800 text-navy-300/g) || []).length;
  console.log('JOB_CHIPS_ON_PAGE=' + chipCount);

  // Pagination indicators
  console.log('HAS_PREV=' + html.includes('>Previous<'));
  console.log('HAS_NEXT=' + html.includes('>Next<'));
  const pageMatch = html.match(/Page (\d+) of (\d+)/);
  console.log('PAGE_INDICATOR=' + (pageMatch ? pageMatch[0] : 'NOT_FOUND'));
  const totalMatch = html.match(/· (\d+) total/);
  console.log('TOTAL_TEXT=' + (totalMatch ? totalMatch[1] : 'NOT_FOUND'));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
