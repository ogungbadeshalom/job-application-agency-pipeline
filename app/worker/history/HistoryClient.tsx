'use client';

import DashboardLayout from '@/components/DashboardLayout';
import type { Job, User } from '@/lib/types';

// Groups a worker's APPLIED jobs by submission week (Mon-Sun) and lists them.
export default function HistoryClient({
  user,
  nav,
  jobs,
}: {
  user: User;
  nav: { href: string; label: string; badge?: number }[];
  jobs: Job[];
}) {
  const applied = jobs.filter((j) => j.status === 'applied' && j.submitted_at);

  // Key each applied job by the Monday (00:00 local) of its submission week.
  // Grouping and display MUST both use local wall-clock dates so a job can never
  // land in a different visible week than the one it was bucketed into, and so a
  // malformed date can't throw (toISOString on Invalid Date raises RangeError).
  function mondayOf(iso: string): Date | null {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const day = (d.getDay() + 6) % 7; // Mon=0
    const mon = new Date(d);
    mon.setDate(d.getDate() - day);
    mon.setHours(0, 0, 0, 0);
    return mon;
  }

  const byWeek = new Map<string, { mon: Date; jobs: Job[] }>();
  for (const j of applied) {
    const mon = mondayOf(j.submitted_at!);
    // Skip jobs with an unparseable submitted_at rather than crashing the page.
    if (!mon) continue;
    // Local date key (not UTC ISO), so the key matches the local "Monday" we
    // render in the header — no tz-dependent off-by-one-day drift.
    const key = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(
      mon.getDate()
    ).padStart(2, '0')}`;
    if (!byWeek.has(key)) byWeek.set(key, { mon, jobs: [] });
    byWeek.get(key)!.jobs.push(j);
  }
  const weeks = Array.from(byWeek.entries()).sort((a, b) => {
    if (a[0] < b[0]) return 1;
    if (a[0] > b[0]) return -1;
    return 0;
  });

  return (
    <DashboardLayout user={user} nav={nav} active="/worker/history">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-navy-100">Completion History</h1>
        <p className="text-sm text-navy-400">Your applied jobs, grouped by week.</p>
      </div>

      {weeks.length === 0 ? (
        <div className="panel p-6 text-center text-navy-400">
          {applied.length === 0
            ? 'No applications completed yet. Jobs you mark Applied will show up here.'
            : 'Your applied jobs are missing valid submission dates, so no weeks can be shown.'}
        </div>
      ) : (
        <div className="panel">
          <div className="divide-y divide-navy-800">
            {weeks.map(([key, { mon, jobs }]) => {
              const wkStart = mon.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
              const sun = new Date(mon);
              sun.setDate(mon.getDate() + 6);
              const wkEnd = sun.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
              const now = Date.now();
              const isCurrent = now >= mon.getTime() && now < sun.getTime() + 86400000;
              return (
                <div key={key} className="px-4 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-medium text-navy-100 flex items-center gap-2">
                      {wkStart} – {wkEnd}
                      {isCurrent && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-green/20 text-brand-green">
                          Current
                        </span>
                      )}
                    </div>
                    <span className="text-sm font-semibold text-navy-200">{jobs.length} applied</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {jobs.map((j) => (
                      <span
                        key={j.id}
                        className="text-xs px-2 py-0.5 rounded bg-navy-800 text-navy-300"
                      >
                        {j.company ? `${j.company} · ` : ''}
                        {j.title}
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