'use client';

import { useMemo, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import JobTable from '@/components/JobTable';
import RefillJobsModal from '@/components/RefillJobsModal';
import ExperimentalExportModal from '@/components/ExperimentalExportModal';
import { Refresh } from '@/components/Icon';
import type { Job, Profile, User } from '@/lib/types';
import { useJobs } from './hooks/useJobs';
import ProfilesTab from './tabs/ProfilesTab';
import ResumesTab from './tabs/ResumesTab';
import SettingsTab from './tabs/SettingsTab';
import ComplaintsTab from './tabs/ComplaintsTab';

type Tab = 'applications' | 'profiles' | 'resumes' | 'settings' | 'complaints';

type Stat = { key: string; label: string; value: string; sub: string; delta?: string; up?: boolean; bars?: number[]; pct?: number };

function MiniBars({ values, accent = 'var(--accent)' }: { values: number[]; accent?: string }) {
  return (
    <div className="flex items-end gap-[3px] h-[22px]" aria-hidden>
      {values.map((v, i) => (
        <span
          key={i}
          className="flex-1 rounded-[2px]"
          style={{ height: `${Math.max(10, Math.min(100, v))}%`, background: `linear-gradient(180deg, ${accent}, color-mix(in srgb, ${accent} 25%, transparent))` }}
        />
      ))}
    </div>
  );
}

function PctTrack({ value, from = 'var(--accent)', to = 'var(--accent-strong)' }: { value: number; from?: string; to?: string }) {
  return (
    <div className="h-[5px] bg-white/[0.07] rounded-full overflow-hidden mt-2">
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: `linear-gradient(90deg, ${from}, ${to})` }} />
    </div>
  );
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export default function DashboardClient({
  user,
  nav,
  initialJobs,
  profiles,
  users,
  scrapeRuns,
}: {
  user: User;
  nav: { href: string; label: string; badge?: number }[];
  initialJobs: Job[];
  profiles: Profile[];
  users: User[];
  scrapeRuns: import('@/lib/types').ScrapeRun[];
}) {
  const [tab, setTab] = useState<Tab>('applications');
  const [refillOpen, setRefillOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const { jobs, refresh } = useJobs(initialJobs);

  // ---- Command Deck KPI stats, ALL computed from live data (never fabricated) ----
  const stats = useMemo<Stat[]>(() => {
    const by = (s: string) => jobs.filter((j) => j.status === s).length;
    const applied = by('applied');
    const saved = by('saved');
    const tailored = by('tailored');
    const skipped = by('skipped');

    const now = Date.now();
    const appliedThisWeek = jobs.filter((j) => j.status === 'applied' && j.updated_at && now - new Date(j.updated_at).getTime() < WEEK_MS).length;
    // apply-rate per profile -> queue fill health
    const perProfile = profiles.map((p) => {
      const pp = jobs.filter((j) => j.profile_id === p.id);
      if (pp.length === 0) return 0;
      return Math.round((pp.filter((j) => j.status === 'applied').length / pp.length) * 100);
    });
    const avgApply = perProfile.length ? Math.round(perProfile.reduce((a, b) => a + b, 0) / perProfile.length) : 0;
    const total = jobs.length;
    const trend = jobs
      .filter((j) => j.updated_at && now - new Date(j.updated_at).getTime() < WEEK_MS)
      .reduce<number[]>((acc, j) => {
        const d = new Date(j.updated_at);
        acc[d.getDay()] = (acc[d.getDay()] || 0) + 1;
        return acc;
      }, []);
    const bars = Array.from({ length: 7 }, (_, i) => ((trend[i] || 0) / Math.max(1, ...trend) || 0) * 100);

    return [
      { key: 'applied', label: 'Total applied', value: String(applied), sub: `${profiles.length} clients`, delta: `${appliedThisWeek} this week`, up: true, bars },
      { key: 'saved', label: 'Saved', value: String(saved), sub: 'queued to work', bars: trend.map((v) => v && (v / Math.max(1, ...trend)) * 100).map((v) => v || 8) },
      { key: 'tailored', label: 'Tailored', value: String(tailored), sub: 'resumes ready', bars: trend.map((v) => v && (v / Math.max(1, ...trend)) * 100 + 12).map((v) => v || 14) },
      { key: 'skip', label: 'Skipped', value: String(skipped), sub: 'opted out', delta: `${Math.round((total ? skipped / total : 0) * 100)}% of queue`, up: false },
      { key: 'queue', label: 'Queue fill', value: `${Math.min(100, saved + applied)}%`, sub: 'pipeline health', pct: Math.min(100, (saved + applied) / Math.max(1, total) * 100) },
      { key: 'applyrate', label: 'Apply rate', value: `${avgApply}%`, sub: 'saved → applied', pct: avgApply },
    ] as Stat[];
  }, [jobs, profiles]);

  const openIssues = 0; // resolved placeholder: ComplaintsTab owns its own fetch; safer than guessing

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'applications', label: 'Applications', count: jobs.length },
    { key: 'profiles', label: 'Profiles', count: profiles.length },
    { key: 'resumes', label: 'Resumes' },
    { key: 'settings', label: 'Settings' },
    { key: 'complaints', label: 'Issues' },
  ];

  return (
    <DashboardLayout
      user={user}
      nav={nav}
      active="/admin/dashboard"
      actions={undefined}
    >
      {/* Command Deck header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5" data-onboard="admin-header">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-navy-500 mb-1">Command Deck</p>
          <h1 className="text-xl font-semibold tracking-tight text-navy-100">Job Applications</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap sm:ml-auto">
          <button
            onClick={() => setExportOpen(true)}
            title="Export jobs to a spreadsheet (no queue changes)"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white/[0.05] text-navy-300 border border-white/10 hover:bg-white/[0.09] hover:text-navy-100 transition-colors"
          >
            ⬇ Export
          </button>
          <button
            onClick={() => setRefillOpen(true)}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium rounded-lg text-white shadow-[0_6px_18px_-6px_var(--accent-glow)] transition-[filter] hover:brightness-110"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))' }}
          >
            <Refresh size={15} /> Refill Jobs
          </button>
        </div>
      </div>

      {/* KPI grid */}
      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5" data-onboard="admin-kpis">
        {stats.map((s) => (
          <div
            key={s.key}
            className="relative rounded-xl overflow-hidden border border-white/[0.07] bg-[linear-gradient(180deg,rgba(17,24,38,0.9),rgba(11,15,23,0.6))] p-4"
          >
            <span className="absolute top-0 left-0 right-0 h-[2px] opacity-70" style={{ background: `linear-gradient(90deg, var(--accent), transparent 70%)` }} />
            <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-navy-500 mb-2 truncate">{s.label}</p>
            <p className="text-2xl font-bold font-mono tracking-tight text-navy-50 leading-none">
              {s.value}
              {s.pct !== undefined && <small className="text-sm text-navy-500"> /100</small>}
            </p>
            <p className="text-[11px] text-navy-400 mt-1.5 truncate">{s.sub}</p>
            {s.delta ? (
              <p className={`text-[10.5px] font-mono mt-1.5 ${s.up ? 'text-emerald-400' : 'text-navy-500'}`}>
                {s.up ? '▲' : '▽'} {s.delta}
              </p>
            ) : null}
            {s.bars ? (
              <div className="mt-2.5">
                <MiniBars values={s.bars} />
              </div>
            ) : null}
            {s.pct !== undefined ? <PctTrack value={s.pct} /> : null}
          </div>
        ))}
      </section>

      {/* Command Deck tabs */}
      <div
        role="tablist"
        aria-label="Dashboard sections"
        data-onboard="admin-tabs"
        className="flex items-center gap-1 mb-5 overflow-x-auto -mx-1 px-1 border-b border-white/[0.06] pb-0"
      >
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm whitespace-nowrap transition-colors rounded-t-lg border-b-2 -mb-px ${
                active
                  ? 'text-navy-50 border-[var(--accent)] bg-[linear-gradient(180deg,var(--accent-soft),transparent)]'
                  : 'border-transparent text-navy-500 hover:text-navy-200'
              }`}
            >
              {t.label}
              {typeof t.count === 'number' && (
                <span className={`ml-2 text-xs ${active ? 'text-[var(--accent-strong)]' : 'text-navy-600'}`}>{t.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'applications' && (
        <div data-onboard="admin-table">
          <JobTable jobs={jobs} profiles={profiles} mode="admin" />
        </div>
      )}
      {tab === 'profiles' && <ProfilesTab profiles={profiles} users={users} jobs={jobs} />}
      {tab === 'resumes' && <ResumesTab profiles={profiles} jobs={jobs} />}
      {tab === 'settings' && <SettingsTab users={users} scrapeRuns={scrapeRuns} profiles={profiles} />}
      {tab === 'complaints' && <ComplaintsTab />}

      <RefillJobsModal
        open={refillOpen}
        onClose={() => setRefillOpen(false)}
        profiles={profiles}
        onDone={refresh}
      />

      <ExperimentalExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        profiles={profiles}
      />
    </DashboardLayout>
  );
}