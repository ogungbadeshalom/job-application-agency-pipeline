import { notFound, redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import JobDetailClient from './JobDetailClient';

export default async function WorkerJobPage({ params }: { params: { id: string } }) {
  const user = await requireRole('worker').catch(() => null);
  if (!user) redirect('/login');

  const job = await db.getJob(params.id);
  if (!job) notFound();

  // Worker may only view jobs for their assigned client.
  const profile = await db.getProfileByWorker(user.id);
  if (!profile || profile.id !== job.profile_id) {
    redirect('/worker/queue');
  }

  const nav = [{ href: '/worker/queue', label: 'Queue' }];

  return (
    <JobDetailClient
      user={user}
      nav={nav}
      job={job}
      profile={profile}
    />
  );
}
