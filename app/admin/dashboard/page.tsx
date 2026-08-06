import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import DashboardClient from './DashboardClient';

export default async function AdminDashboardPage() {
  const user = await requireRole('admin').catch(() => null);
  if (!user) redirect('/login');

  const [jobs, profiles, users, scrapeRuns] = await Promise.all([
    db.listJobs(),
    db.listProfiles(),
    db.listUsers(),
    db.listScrapeRuns(),
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
