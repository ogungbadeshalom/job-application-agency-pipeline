import { getSession, homeForRole } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const metadata = {
  title: 'pitchr — We apply to jobs for you, properly',
  description:
    'We find genuine remote openings, write a tailored resume for each one, submit the application, and track every send with proof. You do none of it.',
};

// Defensive fallback for /. Normally / is served by the beforeFiles rewrite
// (public/index.html) after middleware gates logged-in users to their
// workspace. If this route IS ever reached directly, preserve that same
// behavior: authed -> workspace, anonymous -> the landing page.
export default async function RootPage() {
  const session = await getSession();
  if (session) redirect(homeForRole(session.user.role));
  redirect('/index.html');
}