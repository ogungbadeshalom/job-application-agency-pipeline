'use client';

import { useEffect, useState } from 'react';
import Modal from './Modal';
import { Spinner } from './Icon';
import type { Profile } from '@/lib/types';

// Scrape source options (map to jobspy Site names from the project fork).
// `disabled: true` sites are grayed out — known-flaky on this deployment.
export const SITE_OPTIONS: { name: string; site: string; disabled?: boolean; note?: string }[] = [
  { name: 'Indeed', site: 'indeed' },
  { name: 'LinkedIn', site: 'linkedin' },
  { name: 'RemoteOK', site: 'remoteok' },
  { name: 'BuiltIn', site: 'builtin' },
  { name: 'Greenhouse', site: 'greenhouse' },
  { name: 'SmartRecruiters', site: 'smart_recruiters' },
  { name: 'Glassdoor', site: 'glassdoor', disabled: true, note: 'currently unavailable' },
  { name: 'ZipRecruiter', site: 'zip_recruiter', disabled: true, note: 'currently unavailable' },
];

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
  const [sites, setSites] = useState<string[]>(['indeed', 'linkedin', 'remoteok', 'greenhouse', 'smart_recruiters']);
  const [searchTerms, setSearchTerms] = useState('');
  const [location, setLocation] = useState('United States');
  const [remoteOnly, setRemoteOnly] = useState(true); // most clients want remote
  const [jobType, setJobType] = useState('full time'); // default full-time
  const [includeKw, setIncludeKw] = useState('');
  const [excludeKw, setExcludeKw] = useState('');
  const [removeEasyApply, setRemoveEasyApply] = useState(true); // default on
  const [resultsWanted, setResultsWanted] = useState('100');
  const [hoursOld, setHoursOld] = useState('72');
  const [profileIds, setProfileIds] = useState<string[]>(profiles.map((p) => p.id));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ jobs_found: number; jobs_added: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset the form to defaults every time the modal is opened, so a fresh
  // Refill pops up clean (no stale sites/terms/result from the last run).
  useEffect(() => {
    if (open) {
      setSites(['indeed', 'linkedin', 'remoteok', 'greenhouse', 'smart_recruiters']);
      setSearchTerms('');
      setLocation('United States');
      setRemoteOnly(true);
      setJobType('full time');
      setIncludeKw('');
      setExcludeKw('');
      setRemoveEasyApply(true);
      setResultsWanted('100');
      setHoursOld('72');
      setProfileIds(profiles.map((p) => p.id));
      setLoading(false);
      setResult(null);
      setError(null);
    }
  }, [open, profiles]);

  function toggle(list: string[], set: (v: string[]) => void, value: string, enabled = true) {
    if (!enabled) return; // grayed-out sources can't be toggled
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function submit() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      // Only send enabled sites (never a grayed-out/disabled source).
      const enabledSites = sites.filter((s) => {
        const opt = SITE_OPTIONS.find((o) => o.site === s);
        return !opt?.disabled;
      });
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sites: enabledSites,
          search_terms: searchTerms
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          location: remoteOnly ? 'Remote' : location,
          remote_only: remoteOnly,
          job_type: jobType,
          include_kw: includeKw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          exclude_kw: excludeKw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          remove_easy_apply: removeEasyApply,
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
            <div className="flex flex-wrap gap-2 items-center">
              <button
                type="button"
                onClick={() => setSites(SITE_OPTIONS.filter((o) => !o.disabled).map((o) => o.site))}
                className="px-3 py-1.5 text-sm rounded-full border border-navy-600 text-navy-300 hover:border-brand-blue hover:text-navy-100"
              >
                All
              </button>
              <span className="text-navy-600">·</span>
              {SITE_OPTIONS.map((opt) => {
                const grayed = opt.disabled;
                return (
                  <button
                    key={opt.site}
                    type="button"
                    onClick={() => toggle(sites, setSites, opt.site, !grayed)}
                    title={grayed ? opt.note : undefined}
                    className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                      grayed
                        ? 'bg-navy-900 text-navy-600 border-navy-800 cursor-not-allowed line-through'
                        : sites.includes(opt.site)
                        ? 'bg-brand-green/20 text-brand-green border-brand-green/40'
                        : 'bg-navy-800 text-navy-400 border-navy-700 hover:border-navy-600'
                    }`}
                  >
                    {opt.name}
                    {grayed ? ' · off' : ''}
                  </button>
                );
              })}
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

          <div className="grid grid-cols-2 gap-3">
            <Field label="Must include (comma-separated)">
              <input
                value={includeKw}
                onChange={(e) => setIncludeKw(e.target.value)}
                placeholder="react, typescript, node"
                className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-green"
              />
              <p className="text-xs text-navy-500 mt-1">Keep jobs matching any of these.</p>
            </Field>
            <Field label="Exclude (comma-separated)">
              <input
                value={excludeKw}
                onChange={(e) => setExcludeKw(e.target.value)}
                placeholder="senior, lead, staff"
                className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-red-500"
              />
              <p className="text-xs text-navy-500 mt-1">Drop jobs matching any of these.</p>
            </Field>
          </div>

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

          <div className="flex items-center gap-2 -mt-1">
            <input
              id="remove-easy-apply"
              type="checkbox"
              checked={removeEasyApply}
              onChange={(e) => setRemoveEasyApply(e.target.checked)}
              className="h-4 w-4 rounded border-navy-700 bg-navy-950 text-brand-green focus:ring-brand-green"
            />
            <label htmlFor="remove-easy-apply" className="text-sm text-navy-200 cursor-pointer">
              Remove Easy Apply jobs — skip one-click Easy Apply listings
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Job type">
              <select
                value={jobType}
                onChange={(e) => setJobType(e.target.value)}
                className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
              >
                <option value="">Any</option>
                <option value="full time">Full-time</option>
                <option value="part time">Part-time</option>
                <option value="contract">Contract</option>
                <option value="temporary">Temporary</option>
                <option value="internship">Internship</option>
                <option value="per diem">Per diem</option>
              </select>
            </Field>
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
                onChange={(e) => setResultsWanted(e.target.value)}
                placeholder="100"
                className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
              />
            </Field>
            <Field label="Hours old">
              <input
                type="number"
                value={hoursOld}
                onChange={(e) => setHoursOld(e.target.value)}
                placeholder="72"
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
