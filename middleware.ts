import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

// Route guard for the marketing site v. the app, plus the DEMO READ-ONLY CAGE.
//
// 1. `/` must be a crawlable, canonical homepage (the standalone public/index.html
//    marketing page, served via rewrite with NO redirect). But a logged-in user
//    should still land in their own workspace, not the marketing page. So we gate
//    ONLY `/` here: decode the session JWT, and if the visitor is authenticated,
//    bounce them to their home.
//
// 2. DEMO accounts (users.is_demo): they can LOOK at the app, but can touch
//    NOTHING. Enforced here at the edge for every matched route:
//      - every mutating method (POST/PUT/PATCH/DELETE) → 403 (API) / bounce (pages)
//      - sensitive GETs that expose real data or files → 403
//    Admin/worker READ endpoints are additionally scoped inside their routes
//    (demo admins see demo profiles only), so real client PII never leaves.
//
// This runs on the edge, so no DB access — role and isDemo ride on the JWT.

// GET endpoints a demo session must never read (real data, files, or infra).
const DEMO_BLOCKED_GET = [
  '/api/users',
  '/api/backups',
  '/api/config',
  '/api/earnings',
  '/api/files',
  '/api/tailored',
  '/api/pdf',
  '/api/resume-preview',
  '/api/upload',
  '/api/upload-proof',
  '/api/proof',
  '/api/deploy-webhook',
];

function demoBlocked(pathname: string): boolean {
  return DEMO_BLOCKED_GET.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  let token = null;
  if (secret) {
    for (const secureCookie of [true, false]) {
      try { token = await getToken({ req, secret, secureCookie }); } catch { /* try next */ }
      if (token?.role) break;
    }
  }

  // Homepage gate (unchanged): authenticated users go to their workspace.
  if (pathname === '/') {
    if (!token?.role) return NextResponse.next();
    const home: Record<string, string> = {
      admin: '/admin/dashboard',
      worker: '/worker/queue',
      client: '/client/jobs',
    };
    return NextResponse.redirect(new URL(home[token.role as string] ?? '/login', req.url));
  }

  // Demo read-only cage.
  if (token?.isDemo) {
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (mutating || demoBlocked(pathname)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'Demo account — read-only. Nothing can be created, changed, or downloaded.' },
          { status: 403 }
        );
      }
      return NextResponse.redirect(new URL('/login?demo=readonly', req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  // The root + every app surface (API, dashboards). Page-level auth guards still
  // run after the middleware, so real users are unaffected — this only ADDS the
  // demo cage on top.
  matcher: ['/', '/api/:path*', '/admin/:path*', '/worker/:path*', '/client/:path*'],
};
