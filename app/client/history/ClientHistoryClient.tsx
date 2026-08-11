'use client';

import DashboardLayout from '@/components/DashboardLayout';
import type { Job, User } from '@/lib/types';

// Client's application history: applied jobs grouped by submission week, plus a
// summary of this week's new applications. Mirrors the worker's History view.
export default function ClientHistoryClient({
  user,
  jobs,
}: {
  user: User;
  jobs: Job[];
}) {
  const nav = [{ href: '/client/jobs', label: 'My Applications', badge: jobs.length }, { href: '/client/history', label: 'History' }];

  // Group applied jobs by the Monday of their submission week (local time).
  function monday(iso: string): Date | null {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const mon = new Date(d);
    mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    mon.setHours(0, 0, 0, 0);
    return mon;
  }

  const byWeek = new Map<string, { mon: Date; jobs: Job[] }>();
  for (const j of jobs) {
    if (!j.submitted_at) continue;
    const mon = monday(j.submitted_at);
    if (!mon) continue;
    const key = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;
    if (!byWeek.has(key)) byWeek.set(key, { mon, jobs: [] });
    byWeek.get(key)!.jobs.push(j);
  }
  const weeks = Array.from(byWeek.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));

  // "New this week" = applied jobs grouped under the current week.
  const now = Date.now();
  const thisWeeks = weeks.filter(([, v]) => {
    const mon = v.mon.getTime();
    const sun = mon + 6 * 86400000;
    return now >= mon && now < sun + 86400000;
  });
  const newThisWeek = thisWeeks.reduce((n, [, v]) => n + v.jobs.length, 0);
  const totalApplied = jobs.length;

  const fmtRange = (mon: Date) => {
    const start = mon.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const end = new Date(mon); end.setDate(mon.getDate() + 6);
    return `${start} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  };

  return (
    <DashboardLayout user={user} nav={nav} active="/client/history">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-navy-100">Application History</h1>
        <p className="text-sm text-navy-400">Every job applied on your behalf, grouped by week.</p>
      </div>

      {/* Weekly summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div className="panel p-4">
          <div className="th-uppercase text-navy-400">Set of jobs applied this week</div>
          <div className="text-3xl font-bold text-brand-green">{newThisWeek}</div>
          <div className="text-xs text-navy-500 mt-1">jobs applied in the current week</div>
        </div>
        <div className="panel p-4">
          <div className="th-uppercase text-navy-400">Total applied to date</div>
          <div className="text-3xl font-bold text-navy-100">{totalApplied}</div>
          <div className="text-xs text-navy-500 mt-1">across all weeks</div>
        </div>
      </div>

      {weeks.length === 0 ? (
        <div className="panel p-6 text-center text-navy-400">
          No applications yet. Jobs we apply to on your behalf will appear here.
        </div>
      ) : (
        <div className="panel">
          <div className="divide-y divide-navy-800">
            {weeks.map(([key, { mon, jobs: wkJobs }]) => {
              const isCurrent = now >= mon.getTime() && now < mon.getTime() + 7 * 86400000;
              return (
                <div key={key} className="px-4 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-medium text-navy-100 flex items-center gap-2">
                      {fmtRange(mon)}
                      {isCurrent && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-green/20 text-brand-green">This week</span>
                      )}
                    </div>
                    <span className="text-sm font-semibold text-navy-200">{wkJobs.length} applied</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {wkJobs.map((j) => (
                      <span key={j.id} className="text-xs px-2 py-0.5 rounded bg-navy-800 text-navy-300">
                        {j.company ? `${j.company} · ` : ''}{j.title}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}