import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import QueueClient from './QueueClient';

export default async function WorkerQueuePage() {
  const user = await requireRole('worker').catch(() => null);
  if (!user) redirect('/login');

  const profile = await db.getProfileByWorker(user.id);
  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center text-navy-400">
        No client assigned to you yet.
      </div>
    );
  }

  const jobs = await db.listJobs({ profile_id: profile.id });
  const allProfiles = await db.listProfiles();

  const nav = [
    { href: '/worker/queue', label: 'Queue', badge: jobs.filter((j) => j.status === 'saved').length },
  ];

  return <QueueClient user={user} nav={nav} jobs={jobs} profiles={allProfiles} />;
}
