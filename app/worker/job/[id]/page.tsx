import { notFound, redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import JobDetailClient from './JobDetailClient';

export default async function WorkerJobPage({ params }: { params: { id: string } }) {
  const user = await requireRole('worker').catch(() => null);
  if (!user) redirect('/login');

  const job = await db.getJob(params.id);
  if (!job) notFound();

  // Worker may only view jobs for a client they're assigned to (any of them).
  if (!(await db.workerHasClient(user.id, job.profile_id))) {
    redirect('/worker/queue');
  }

  // Profile for THIS job's client (worker may not be primary on it, so resolve
  // directly rather than assuming getProfileByWorker).
  const profile = await db.getProfile(job.profile_id);
  if (!profile) redirect('/worker/queue');

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
