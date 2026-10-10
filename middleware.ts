import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

// Route guard for the marketing site v. the app.
//
// `/` must be a crawlable, canonical homepage (the standalone public/index.html
// marketing page, served via rewrite with NO redirect). But a logged-in user
// should still land in their own workspace, not the marketing page. So we gate
// ONLY `/` here: decode the session JWT, and if the visitor is authenticated,
// bounce them to their home. Every other route passes through untouched (the
// app's /login and /client/* guards already handle themselves).
//
// This runs on the edge, so no DB access — role rides on the JWT.

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname !== '/') return NextResponse.next();

  try {
    const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
    if (!secret) return NextResponse.next();
    // Production (https tunnel) uses the __Secure- prefixed cookie; local http
    // doesn't. Try both so the gate works wherever it's served.
    let token = null;
    for (const secureCookie of [true, false]) {
      try { token = await getToken({ req, secret, secureCookie }); } catch { /* try next */ }
      if (token?.role) break;
    }
    if (!token?.role) return NextResponse.next();

    const home: Record<string, string> = {
      admin: '/admin/dashboard',
      worker: '/worker/queue',
      client: '/client/jobs',
    };
    const dest = home[token.role as string] ?? '/login';
    return NextResponse.redirect(new URL(dest, req.url));
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  // Only intercept the root. Everything else (login, client, worker, admin,
  // static marketing pages) is handled by its own route/layout/auth logic.
  matcher: ['/'],
};