'use client';

import { useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import type { Job, User } from '@/lib/types';

const PAGE_SIZE = 25;

// Client's application history: applied jobs grouped by submission week, plus a
// summary of this week's new applications. Mirrors the worker's History view.
export default function ClientHistoryClient({
  user,
  jobs,
}: {
  user: User;
  jobs: Job[];
}) {
  // Client-side pagination: newest first, 25 jobs per page. All jobs arrive as
  // props; we slice here so the page stays a bounded list instead of endless.
  const [page, setPage] = useState(1);
  const sorted = [...jobs]
    .filter((j) => j.submitted_at)
    .sort((a, b) => (a.submitted_at! < b.submitted_at! ? 1 : -1));
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageJobs = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const nav = [{ href: '/client/jobs', label: 'My Applications', badge: jobs.length }, { href: '/client/resume-lab', label: 'Resume Lab' }, { href: '/client/history', label: 'History' }];

  // Group applied jobs by the Monday of their submission week (local time).
  function monday(iso: string): Date | null {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const mon = new Date(d);
    mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    mon.setHours(0, 0, 0, 0);
    return mon;
  }

  // Group only this page's jobs for the week-grouped list.
  const byWeek = new Map<string, { mon: Date; jobs: Job[] }>();
  for (const j of pageJobs) {
    const mon = monday(j.submitted_at!);
    if (!mon) continue;
    const key = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;
    if (!byWeek.has(key)) byWeek.set(key, { mon, jobs: [] });
    byWeek.get(key)!.jobs.push(j);
  }
  const weeks = Array.from(byWeek.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));

  // Summary cards always reflect the FULL dataset, not the visible page.
  const now = Date.now();
  const weekStart = (iso: string): number | null => {
    const mon = monday(iso);
    return mon ? mon.getTime() : null;
  };
  const newThisWeek = sorted.filter((j) => {
    const ts = j.submitted_at ? weekStart(j.submitted_at) : null;
    return ts !== null && now >= ts && now < ts + 7 * 86400000;
  }).length;
  const totalApplied = jobs.length;

  const fmtRange = (mon: Date) => {
    const start = mon.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const end = new Date(mon); end.setDate(mon.getDate() + 6);
    return `${start} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  };

  return (
    <DashboardLayout user={user} nav={nav} active="/client/history">
      <div className="mb-4" data-onboard="client-history">
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

      {sorted.length === 0 ? (
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

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="panel mt-4 px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="text-sm text-navy-400 text-center sm:text-left">
            Page {safePage} of {totalPages} · {sorted.length} total
          </span>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="flex-1 sm:flex-none px-3 py-2 sm:py-1.5 rounded bg-brand-greenDark text-white text-sm hover:bg-brand-green disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="flex-1 sm:flex-none px-3 py-2 sm:py-1.5 rounded bg-brand-greenDark text-white text-sm hover:bg-brand-green disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}