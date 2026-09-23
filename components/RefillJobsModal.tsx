'use client';

import { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import { Spinner } from './Icon';
import type { Profile } from '@/lib/types';

const SCRAPE_TIMEOUT_MS = 600_000; // 10 min — generous ceiling for JobSpy

// Working job boards for this deployment (non-flaky).
export const SITE_OPTIONS: { name: string; site: string }[] = [
  { name: 'Greenhouse', site: 'greenhouse' },
  { name: 'BuiltIn', site: 'builtin' },
  { name: 'Jobicy', site: 'jobicy' },
  { name: 'RemoteOK', site: 'remoteok' },
  { name: 'WorkingNomads', site: 'workingnomads' },
  { name: 'Ashby', site: 'ashby' },
  { name: 'SmartRecruiters', site: 'smart_recruiters' },
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
  const [sites, setSites] = useState<string[]>(SITE_OPTIONS.map((o) => o.site));
  const [searchTerms, setSearchTerms] = useState('');
  const [location, setLocation] = useState('United States');
  const [remoteOnly, setRemoteOnly] = useState(true); // most clients want remote
  const [resultsWanted, setResultsWanted] = useState('100');
  const [hoursOld, setHoursOld] = useState('72');
  const [profileIds, setProfileIds] = useState<string[]>(profiles.map((p) => p.id));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ jobs_found: number; jobs_added: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ step: number; totalSteps: number; current: string; jobsFound: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Poll live progress while a scrape runs.
  useEffect(() => {
    if (!loading) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch('/api/scrape/progress', { cache: 'no-store' });
        if (!cancelled && res.ok) {
          const p = (await res.json().catch(() => ({})))?.progress;
          if (p && typeof p.totalSteps === 'number') {
            setProgress({ step: p.step ?? 0, totalSteps: p.totalSteps, current: p.current ?? '', jobsFound: p.jobsFound ?? 0 });
          }
        }
      } catch {}
      if (!cancelled) setTimeout(tick, 1200);
    };
    tick();
    return () => { cancelled = true; };
  }, [loading]);

  // Reset form each open.
  useEffect(() => {
    if (open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setSites(SITE_OPTIONS.map((o) => o.site));
      setSearchTerms('');
      setLocation('United States');
      setRemoteOnly(true);
      setResultsWanted('100');
      setHoursOld('72');
      setProfileIds(profiles.map((p) => p.id));
      setLoading(false);
      setResult(null);
      setError(null);
      setProgress(null);
    }
  }, [open, profiles]);

  function toggle(list: string[], set: (v: string[]) => void, value: string) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function submit() {
    if (loading) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const token = setTimeout(() => controller.abort('timeout'), SCRAPE_TIMEOUT_MS);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sites,
          search_terms: searchTerms.split(',').map((s) => s.trim()).filter(Boolean),
          location: remoteOnly ? 'Remote' : location,
          remote_only: remoteOnly,
          results_wanted: Number(resultsWanted) || 100,
          hours_old: Number(hoursOld) || 72,
          profile_ids: profileIds,
        }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || 'Scrape failed');
      }
      const data = (await res.json().catch(() => null)) ?? {};
      if (typeof data.jobs_added !== 'number' || typeof data.jobs_found !== 'number') {
        throw new Error('Scrape request failed to return results. Please try again.');
      }
      setResult({ jobs_found: data.jobs_found, jobs_added: data.jobs_added });
      onDone?.({ jobs_added: data.jobs_added });
      setTimeout(() => onClose(), 1200);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setError('The scrape took too long and was stopped. Check Scrape Run History for partial results, then try again.');
      } else {
        setError(e instanceof Error ? e.message : 'Unknown error');
      }
    } finally {
      clearTimeout(token);
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Refill Jobs"
      subtitle="Scrape fresh postings into the queue."
      wide
      footer={
        <>
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md text-navy-300 hover:bg-navy-800">
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={submit}
              disabled={loading || profileIds.length === 0}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-brand-greenDark text-white hover:bg-brand-green disabled:opacity-50"
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
            {result.jobs_found} found across {sites.length} {sites.length === 1 ? 'site' : 'sites'} · deduped by URL
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Sites">
            <div className="flex flex-wrap gap-2 items-center">
              <button
                type="button"
                onClick={() => setSites(SITE_OPTIONS.map((o) => o.site))}
                className="px-3 py-1.5 text-sm rounded-full border border-navy-600 text-navy-300 hover:border-brand-blue hover:text-navy-100"
              >
                All
              </button>
              <span className="text-navy-600">·</span>
              {SITE_OPTIONS.map((opt) => (
                <button
                  key={opt.site}
                  type="button"
                  onClick={() => toggle(sites, setSites, opt.site)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                    sites.includes(opt.site)
                      ? 'bg-brand-green/20 text-brand-green border-brand-green/40'
                      : 'bg-navy-800 text-navy-400 border-navy-700 hover:border-navy-600'
                  }`}
                >
                  {opt.name}
                </button>
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
            <p className="text-xs text-navy-500 mt-1">Leave blank to use each client&apos;s saved search terms.</p>
          </Field>

          <div className="flex items-center gap-2">
            <input
              id="remote-only"
              type="checkbox"
              checked={remoteOnly}
              onChange={(e) => setRemoteOnly(e.target.checked)}
              className="h-4 w-4 rounded border-navy-700 bg-navy-950 text-brand-green focus:ring-brand-green"
            />
            <label htmlFor="remote-only" className="text-sm text-navy-200 cursor-pointer">
              Remote only — overrides the location field
            </label>
          </div>

          {!remoteOnly && (
            <Field label="Location">
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
              />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
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
                <Chip key={p.id} active={profileIds.includes(p.id)} onClick={() => toggle(profileIds, setProfileIds, p.id)}>
                  {p.name}
                </Chip>
              ))}
            </div>
          </Field>

          {loading && (
            <div className="rounded-lg border border-brand-green/30 bg-brand-green/5 p-3">
              {progress && progress.totalSteps > 0 && (
                <>
                  <div className="flex justify-between text-xs text-navy-300 mb-1">
                    <span>{progress.current || 'working'}</span>
                    <span>{progress.jobsFound} jobs</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-navy-800 overflow-hidden">
                    <div
                      className="h-full bg-[var(--accent)] transition-all duration-500"
                      style={{ width: `${Math.min(100, ((progress.step + 1) / progress.totalSteps) * 100)}%` }}
                    />
                  </div>
                </>
              )}
            </div>
          )}

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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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