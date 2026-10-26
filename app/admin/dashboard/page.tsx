import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import DashboardClient from './DashboardClient';

export default async function AdminDashboardPage({ searchParams }: { searchParams: { refill?: string } }) {
  const user = await requireRole('admin').catch(() => null);
  if (!user) redirect('/login');

  const [jobsAll, profilesAll, users, scrapeRuns] = await Promise.all([
    db.listJobsSlim(),
    db.listProfiles(),
    db.listUsers(),
    db.listScrapeRuns(25), // cap to recent runs so the history table doesn't render all 287+ and bloat the page
  ]);

  // Demo cage at the page level: server components bypass the API middleware,
  // so a demo admin must be scoped here too. Demo sessions see ONLY demo
  // profiles (email @demo.pitchr) — real clients, users, and runs are hidden.
  let jobs = jobsAll;
  let profiles = profilesAll;
  let runs = scrapeRuns;
  if (user.is_demo) {
    profiles = profilesAll.filter((p) => p.email.toLowerCase().endsWith('@demo.pitchr'));
    const demoIds = new Set(profiles.map((p) => p.id));
    jobs = jobsAll.filter((j) => demoIds.has(j.profile_id));
    runs = scrapeRuns.filter((r) => (r.profile_ids ?? []).some((id) => demoIds.has(id)));
    return (
      <DashboardClient
        user={user}
        nav={[{ href: '/admin/dashboard', label: 'Dashboard', badge: jobs.filter((j) => j.status === 'applied').length }]}
        initialJobs={jobs}
        profiles={profiles}
        users={users.filter((u) => u.email.toLowerCase().endsWith('@demo.pitchr'))}
        scrapeRuns={runs}
        defaultRefillOpen={false}
      />
    );
  }

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
      scrapeRuns={runs}
      defaultRefillOpen={searchParams.refill === '1'}
    />
  );
}
