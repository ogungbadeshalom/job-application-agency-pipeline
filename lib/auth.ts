// Auth.js singleton + app-level role helpers.
//
// This module is the single chokepoint for auth in the app:
//   - `handlers` / `signIn` / `signOut` — exported for the API route it's used
//     by (app/api/auth/[...nextauth]/route.ts) and the login page.
//   - `auth()` — server-side session getter (reads the Auth.js JWT cookie).
//   - `requireRole(...roles)` — page/API gate. Redirects to the role's home on
//     missing session, or to the user's own home if they lack a required role.
//
// Role checks are APP-LEVEL (not DB RLS): the role rides on the signed JWT,
// which is fine for a 1+3+3 person system and far less failure-prone than
// database row-level policies.

import NextAuth from 'next-auth';
import { redirect } from 'next/navigation';
import { authConfig } from './auth-config';
import { db } from './db';
import type { Role, User } from './types';

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

// Compatibility shim: returns { session: { user } } with `user` shaped like the
// domain `User` record. API routes call `getSession()` and read `session.user`.
export async function getSession(): Promise<{ user: User } | null> {
  const user = await currentUser();
  return user ? { user } : null;
}

// Hydrate a full user record (role + profile) from the session.
// This is the single chokepoint every page guard (requireRole) and API guard
// (getSession) resolves the JWT through. Because Auth.js uses stateless JWT
// sessions, a disabled user's cookie stays valid even after an admin soft-
// disables them — so we must null the user HERE the moment `disabled_at` is
// set. Otherwise a disabled user keeps full access (role rides on the JWT)
// until the cookie expires, defeating the soft-disable.
export async function currentUser(): Promise<User | null> {
  const session = await auth();
  const sessionUser = session?.user as { id?: string } | undefined;
  if (!sessionUser?.id) return null;
  const user = await db.getUser(sessionUser.id);
  // A disabled user is treated as signed out: force a fresh login. This makes
  // soft-disable take effect immediately across every page + API route.
  if (user?.disabled_at) return null;
  return user;
}

// Gate a server component / route. Returns the hydrated user on success.
export async function requireRole(...roles: Role[]): Promise<User> {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!roles.includes(user.role)) {
    redirect(homeForRole(user.role));
  }
  return user;
}

export function homeForRole(role: Role): string {
  switch (role) {
    case 'admin':
      return '/admin/dashboard';
    case 'worker':
      return '/worker/queue';
    case 'client':
      return '/client/jobs';
    default:
      return '/login';
  }
}