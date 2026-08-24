import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import ResumeLabClient from './ResumeLabClient';

export default async function ResumeLabPage() {
  const user = await requireRole('worker').catch(() => null);
  if (!user) redirect('/login');

  const clientProfiles = await db.listProfilesByWorker(user.id);
  const nav = [
    { href: '/worker/queue', label: 'Queue' },
    { href: '/worker/resume-lab', label: 'Resume Lab' },
    { href: '/worker/history', label: 'History' },
  ];

  return (
    <ResumeLabClient
      user={user}
      nav={nav}
      clientProfiles={clientProfiles}
    />
  );
}