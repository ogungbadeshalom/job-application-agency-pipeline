import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import ResumeLabClient from '@/components/ResumeLab/ResumeLabClient';

export default async function ClientResumeLabPage() {
  const user = await requireRole('client').catch(() => null);
  if (!user) redirect('/login');

  // A client sees ONLY their own resume + design, not other clients.
  const profile = user.profile_id ? await db.getProfile(user.profile_id) : null;
  const clientProfiles = profile ? [profile] : [];

  const nav = [
    { href: '/client/jobs', label: 'My Applications' },
    { href: '/client/resume-lab', label: 'Resume Lab' },
    { href: '/client/history', label: 'History' },
  ];

  return (
    <ResumeLabClient
      user={user}
      nav={nav}
      clientProfiles={clientProfiles}
    />
  );
}