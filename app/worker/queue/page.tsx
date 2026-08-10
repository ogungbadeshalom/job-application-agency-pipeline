import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import QueueClient from './QueueClient';

// Start of the current week (Monday 00:00 local).
function weekStart(): Date {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() - day);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

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
  const weeklyStats = await db.getWorkerWeeklyStats(profile.id, weekStart());

  const nav = [
    { href: '/worker/queue', label: 'Queue', badge: jobs.filter((j) => j.status === 'saved').length },
    { href: '/worker/history', label: 'History' },
  ];

  return (
    <QueueClient
      user={user}
      nav={nav}
      jobs={jobs}
      profiles={allProfiles}
      quota={profile.jobs_per_week}
      weeklyApplied={weeklyStats.applied}
      weeklySkipped={weeklyStats.skipped}
    />
  );
}
