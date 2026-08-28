'use client';

import { useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import JobTable from '@/components/JobTable';
import RefillJobsModal from '@/components/RefillJobsModal';
import ExperimentalExportModal from '@/components/ExperimentalExportModal';
import { Refresh } from '@/components/Icon';
import type { Job, Profile, ScrapeRun, User } from '@/lib/types';
import { useJobs } from './hooks/useJobs';
import ProfilesTab from './tabs/ProfilesTab';
import ResumesTab from './tabs/ResumesTab';
import SettingsTab from './tabs/SettingsTab';

type Tab = 'applications' | 'profiles' | 'resumes' | 'settings';

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
  scrapeRuns: ScrapeRun[];
}) {
  const [tab, setTab] = useState<Tab>('applications');
  const [refillOpen, setRefillOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const { jobs, refresh } = useJobs(initialJobs);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'applications', label: 'Applications', count: jobs.length },
    { key: 'profiles', label: 'Profiles', count: profiles.length },
    { key: 'resumes', label: 'Resumes' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <DashboardLayout
      user={user}
      nav={nav}
      active="/admin/dashboard"
      actions={undefined}
    >
      {/* Page header with title + primary actions (kept out of the narrow
          sidebar where the compact rail has no room for buttons) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-xl font-semibold tracking-tight text-pretty text-navy-100">
          Job Applications
        </h1>
        <div className="flex items-center gap-2 flex-wrap sm:ml-auto">
          <button
            onClick={() => setExportOpen(true)}
            title="Export jobs to a spreadsheet (no queue changes)"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-brand-yellow/15 text-brand-yellow border border-brand-yellow/30 hover:bg-brand-yellow/25 transition-colors"
          >
            ⬇ Export
          </button>
          <button
            onClick={() => setRefillOpen(true)}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium rounded-md bg-brand-green text-navy-950 hover:bg-brand-greenDark shadow-[0_4px_14px_-4px_var(--accent-glow)] transition-colors"
          >
            <Refresh size={15} /> Refill Jobs
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Dashboard sections"
        className="flex items-center gap-1 border-b border-navy-700 mb-5 overflow-x-auto -mx-1 px-1"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === t.key
                ? 'border-brand-green text-navy-100'
                : 'border-transparent text-navy-400 hover:text-navy-200'
            }`}
          >
            {t.label}
            {typeof t.count === 'number' && (
              <span className="ml-2 text-xs text-navy-500">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'applications' && (
        <JobTable jobs={jobs} profiles={profiles} mode="admin" />
      )}
      {tab === 'profiles' && <ProfilesTab profiles={profiles} users={users} jobs={jobs} />}
      {tab === 'resumes' && <ResumesTab profiles={profiles} jobs={jobs} />}
      {tab === 'settings' && <SettingsTab users={users} scrapeRuns={scrapeRuns} />}

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