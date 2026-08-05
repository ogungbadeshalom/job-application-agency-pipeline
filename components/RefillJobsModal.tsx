'use client';

import { useState } from 'react';
import Modal from './Modal';
import { Spinner } from './Icon';
import type { Profile } from '@/lib/types';

const SITE_OPTIONS = ['indeed', 'linkedin', 'glassdoor'];

export default function RefillJobsModal({
  open,
  onClose,
  profiles,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  profiles: Profile[];
  onDone?: (result: { jobs_added: number }) => void;
}) {
  const [sites, setSites] = useState<string[]>(['indeed', 'linkedin']);
  const [searchTerms, setSearchTerms] = useState('');
  const [location, setLocation] = useState('United States');
  const [remoteOnly, setRemoteOnly] = useState(true); // most clients want remote
  const [resultsWanted, setResultsWanted] = useState(100);
  const [hoursOld, setHoursOld] = useState(72);
  const [profileIds, setProfileIds] = useState<string[]>(profiles.map((p) => p.id));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ jobs_found: number; jobs_added: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(list: string[], set: (v: string[]) => void, value: string) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function submit() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sites,
          search_terms: searchTerms
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          location: remoteOnly ? 'Remote' : location,
          remote_only: remoteOnly,
          results_wanted: Number(resultsWanted) || 100,
          hours_old: Number(hoursOld) || 72,
          profile_ids: profileIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scrape failed');
      setResult({ jobs_found: data.jobs_found, jobs_added: data.jobs_added });
      // Fire the soft-update so the Applications table updates in place.
      onDone?.({ jobs_added: data.jobs_added });
      // Auto-close after a beat so the user sees the result.
      setTimeout(() => onClose(), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Refill Jobs"
      subtitle="Run JobSpy to pull fresh postings into the queue."
      wide
      footer={
        <>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md text-navy-300 hover:bg-navy-800"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={submit}
              disabled={loading || profileIds.length === 0}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-brand-greenDark text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {loading ? <Spinner /> : null}
              {loading ? 'Scraping…' : 'Run scrape'}
            </button>
          )}
        </>
      }
    >
      {result ? (
        <div className="text-center py-8">
          <div className="text-4xl mb-2">✅</div>
          <div className="text-lg font-semibold text-navy-100">
            {result.jobs_added} new {result.jobs_added === 1 ? 'job' : 'jobs'} added
          </div>
          <div className="text-sm text-navy-400 mt-1">
            {result.jobs_found} found across {sites.length} {sites.length === 1 ? 'site' : 'sites'} ·
            deduped by URL
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Sites">
            <div className="flex gap-2">
              {SITE_OPTIONS.map((s) => (
                <Chip key={s} active={sites.includes(s)} onClick={() => toggle(sites, setSites, s)}>
                  {s}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Search terms (comma-separated)">
            <input
              value={searchTerms}
              onChange={(e) => setSearchTerms(e.target.value)}
              placeholder="backend engineer, platform engineer"
              className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
            />
            <p className="text-xs text-navy-500 mt-1">
              Leave blank to use each client&apos;s saved search terms from their profile.
            </p>
          </Field>

          <div className="flex items-center gap-2 -mt-1">
            <input
              id="remote-only"
              type="checkbox"
              checked={remoteOnly}
              onChange={(e) => setRemoteOnly(e.target.checked)}
              className="h-4 w-4 rounded border-navy-700 bg-navy-950 text-brand-green focus:ring-brand-green"
            />
            <label htmlFor="remote-only" className="text-sm text-navy-200 cursor-pointer">
              Remote only — overrides the location field for all target profiles
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Location">
              <input
                value={remoteOnly ? 'Remote' : location}
                onChange={(e) => setLocation(e.target.value)}
                disabled={remoteOnly}
                className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue disabled:opacity-60"
              />
            </Field>
            <Field label="Results / term">
              <input
                type="number"
                value={resultsWanted}
                onChange={(e) => setResultsWanted(Number(e.target.value))}
                className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
              />
            </Field>
            <Field label="Hours old">
              <input
                type="number"
                value={hoursOld}
                onChange={(e) => setHoursOld(Number(e.target.value))}
                className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
              />
            </Field>
          </div>

          <Field label="Target profiles">
            <div className="flex flex-wrap gap-2">
              {profiles.map((p) => (
                <Chip
                  key={p.id}
                  active={profileIds.includes(p.id)}
                  onClick={() => toggle(profileIds, setProfileIds, p.id)}
                >
                  {p.name}
                </Chip>
              ))}
            </div>
          </Field>

          {error && (
            <div className="text-sm text-brand-red bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block th-uppercase mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-full capitalize border transition-colors ${
        active
          ? 'bg-brand-green/20 text-brand-green border-brand-green/40'
          : 'bg-navy-800 text-navy-400 border-navy-700 hover:border-navy-600'
      }`}
    >
      {children}
    </button>
  );
}
