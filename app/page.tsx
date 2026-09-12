import { getSession, homeForRole } from '@/lib/auth';
import { redirect } from 'next/navigation';
import CommandDeckLanding from '@/components/CommandDeckLanding';

export const metadata = {
  title: 'JobBidder — Your AI application agency',
  description:
    'JobBidder finds verified remote roles, writes a bespoke resume per job, and submits your applications while you work.',
};

// Server root: an authenticated user lands in their own workspace; everyone
// else sees the public "Command Deck" landing page (pitchr.com.ng/) whose CTA
// buttons link into /login (and /auth pages), so the marketing site and the app
// share the root cleanly.
export default async function RootPage() {
  const session = await getSession();
  if (session) redirect(homeForRole(session.user.role));
  return <CommandDeckLanding />;
}