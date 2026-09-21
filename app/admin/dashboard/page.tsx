import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import DashboardClient from './DashboardClient';

export default async function AdminDashboardPage() {
  const user = await requireRole('admin').catch(() => null);
  if (!user) redirect('/login');

  const [jobs, profiles, users, scrapeRuns] = await Promise.all([
    db.listJobsSlim(),
    db.listProfiles(),
    db.listUsers(),
    db.listScrapeRuns(25), // cap to recent runs so the history table doesn't render all 287+ and bloat the page
  ]);

  const appliedCount = jobs.filter((j) => j.status === 'applied').length;

  const nav = [
    { href: '/admin/dashboard', label: 'Dashboard', badge: appliedCount },
  ];

  return (
    <DashboardClient
      user={user}
      nav={nav}
      initialJobs={jobs}
      profiles={profiles}
      users={users}
      scrapeRuns={scrapeRuns}
    />
  );
}
