import { getSession, homeForRole } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const metadata = {
  title: 'pitchr — We apply to jobs for you, properly',
  description:
    'We find genuine remote openings, write a tailored resume for each one, submit the application, and track every send with proof. You do none of it.',
};

// Server root: an authenticated user lands in their own workspace; everyone
// else sees the public marketing landing (public/index.html — the standalone
// pitchr site). The marketing pages are static HTML served from /, so we
// redirect anonymous visitors there. /login and /client/* (the live app) are
// untouched by this.
export default async function RootPage() {
  const session = await getSession();
  if (session) redirect(homeForRole(session.user.role));
  redirect('/index.html');
}