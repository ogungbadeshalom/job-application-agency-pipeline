import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { roleGuidesForProfiles } from '@/lib/roleGuide';
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

export default async function WorkerQueuePage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
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
  // Resolve the ?client= query param (if present and valid) so the queue opens
  // on that client — e.g. coming back from a job's "Back to queue". Falls back
  // to 'all' for a missing/unknown id.
  const rawClient = typeof searchParams?.client === 'string' ? searchParams.client : '';
  const initialClientId = profiles.some((p) => p.id === rawClient) ? rawClient : 'all';
  const profileIds = profiles.map((p) => p.id);
  const jobs = await db.listJobsSlim({ profile_ids: profileIds });
  const allProfiles = await db.listProfiles();
  // weekly stats across ALL the worker's clients + broken down per client, so
  // the queue's client switcher can show each client's own applied/skipped.
  const wkStart = weekStart();
  const weeklyStats = await db.getWorkerWeeklyStats(profileIds, wkStart);
  const byClient = await db.getWorkerWeeklyStatsByClient(profileIds, wkStart);
  const clientStats: Record<string, { applied: number; skipped: number; quota: number }> = {};
  for (const p of profiles) {
    const s = byClient[p.id] ?? { applied: 0, skipped: 0 };
    clientStats[p.id] = { applied: s.applied, skipped: s.skipped, quota: p.jobs_per_week || 20 };
  }
  const allQuota = profiles.reduce((sum, p) => sum + (p.jobs_per_week || 20), 0);

  // Earnings pool meter: per-client weekly naira. Only the worker-safe fields
  // are passed down — the private per-app rate stays on the server.
  const earningsByClient: Record<string, { earnedNaira: number; weeklyCapNaira: number; countThisWeek: number }> = {};
  for (const p of profiles) {
    const e = await db.getWorkerEarnings(p.id);
    earningsByClient[p.id] = {
      earnedNaira: e.earnedNaira,
      weeklyCapNaira: e.weeklyCapNaira,
      countThisWeek: e.countThisWeek,
    };
  }

  const allEarnings = {
    earnedNaira: Object.values(earningsByClient).reduce((s, e) => s + e.earnedNaira, 0),
    countThisWeek: Object.values(earningsByClient).reduce((s, e) => s + e.countThisWeek, 0),
    // "All" = sum of every client's weekly cap (e.g. 3500 x N clients), so a
    // worker handling multiple clients sees the combined pool.
    weeklyCapNaira: Object.values(earningsByClient).reduce((s, e) => s + e.weeklyCapNaira, 0),
  };

  // Role guide: the roles each assigned client's resume supports, so workers
  // know what to apply for and don't skip valid titles recklessly.
  const clientRoles = roleGuidesForProfiles(profiles);

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
      clientProfiles={profiles}
      initialClientId={initialClientId}
      quota={allQuota}
      weeklyApplied={weeklyStats.applied}
      weeklySkipped={weeklyStats.skipped}
      clientStats={clientStats}
      weeklyEarnings={allEarnings}
      earningsByClient={earningsByClient}
      clientRoles={clientRoles}
    />
  );
}
