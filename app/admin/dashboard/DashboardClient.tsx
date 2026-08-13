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
      actions={
        <>
          <button
            onClick={() => setRefillOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-brand-greenDark text-white hover:bg-emerald-700"
          >
            <Refresh size={15} /> Refill Jobs
          </button>
          <button
            onClick={() => setExportOpen(true)}
            title="Experimental — scrape jobs to a spreadsheet (no queue changes)"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-amber-500/15 text-amber-200 border border-amber-500/30 hover:bg-amber-500/25"
          >
            ⬇ Experimental
          </button>
        </>
      }
    >
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