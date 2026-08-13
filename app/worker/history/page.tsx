import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import HistoryClient from './HistoryClient';

export default async function WorkerHistoryPage() {
  const user = await requireRole('worker').catch(() => null);
  if (!user) redirect('/login');

  const profiles = await db.listProfilesByWorker(user.id);
  if (!profiles.length) {
    return (
      <div className="min-h-screen flex items-center justify-center text-navy-400">
        No client assigned to you yet.
      </div>
    );
  }

  const jobs = await db.listJobs({ profile_ids: profiles.map((p) => p.id) });

  const nav = [
    { href: '/worker/queue', label: 'Queue', badge: jobs.filter((j) => j.status === 'saved').length },
    { href: '/worker/history', label: 'History' },
  ];

  return <HistoryClient user={user} nav={nav} jobs={jobs} />;
}