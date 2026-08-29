// Auth.js (NextAuth v5) configuration.
//
// Strategy: Credentials provider + JWT. Passwords hashed with bcryptjs in the
// `users` table. Role is pulled from the DB, placed on the JWT/session, and
// checked via requireRole() in lib/auth-helpers.ts — app-level role checks,
// no database RLS.
//
// This file must not import server-only modules directly. It's split from
// lib/auth.ts so both the route handler (server) and helpers can reuse it.

import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { db } from './db';

export const authConfig: NextAuthConfig = {
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = String(credentials.email);
        const password = String(credentials.password);

        const row = await db.getAuthUserByEmail(email);
        if (!row) return null;

        const ok = await compare(password, row.password_hash);
        if (!ok) return null;

        return {
          id: row.id,
          email: row.email,
          name: row.full_name,
          role: row.role,
          accent: row.accent,
        };
      },
    }),
  ],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id;
        token.role = (user as { role: string }).role;
        token.name = user.name;
        token.accent = (user as { accent: string }).accent ?? '';
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        const user = session.user as unknown as {
          id?: string;
          role?: string;
          email?: string;
          name?: string;
          accent?: string;
        };
        user.id = token.id as string;
        user.role = token.role as string;
        user.email = (token.email as string) ?? user.email;
        user.name = (token.name as string) ?? user.name;
        user.accent = (token.accent as string) ?? '';
      }
      return session;
    },
  },
};