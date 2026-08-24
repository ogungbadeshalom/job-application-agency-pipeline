'use client';

import { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import { Spinner } from './Icon';
import type { Profile, ProfilePreset } from '@/lib/types';

// Client-side cap for the /api/scrape round-trip. JobSpy can legitimately take
// a couple of minutes, but if the proxy/backend hangs and never responds we
// must not leave the modal stuck in a permanent "Scraping…" loading state.
// The server also enforces its own 150s-per-board subprocess cap, so this is a
// generous ceiling well above that — it only fires for truly hung requests.
const SCRAPE_TIMEOUT_MS = 600_000; // 10 min

// Scrape source options (map to jobspy Site names from the project fork).
// `disabled: true` sites are grayed out — known-flaky on this deployment.
export const SITE_OPTIONS: { name: string; site: string; disabled?: boolean; note?: string }[] = [
  { name: 'Indeed', site: 'indeed', disabled: true, note: 'disabled — removed from using (blocking/anti-bot on this deployment)' },
  { name: 'LinkedIn', site: 'linkedin', disabled: true, note: 'disabled — free/guest scrape has no remote/onsite signal (yields ~0 strict-remote)' },
  { name: 'RemoteOK', site: 'remoteok', disabled: true, note: 'disabled — ~0 yield from this server' },
  { name: 'BuiltIn', site: 'builtin' },
  { name: 'Greenhouse', site: 'greenhouse', note: 'ATS per-company board' },
  { name: 'Lever', site: 'lever', disabled: true, note: 'disabled — returns 0 from this server' },
  { name: 'SmartRecruiters', site: 'smart_recruiters', disabled: true, note: 'returning 0 from this server' },
  { name: 'WorkingNomads', site: 'workingnomads' },
  { name: 'Jobicy', site: 'jobicy', note: 'remote-only aggregator' },
  { name: 'HiringCafe', site: 'hiringcafe', note: 'opt-in, uses headless browser (slow)' },
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
  const [sites, setSites] = useState<string[]>(['linkedin','builtin','greenhouse','workingnomads','jobicy']);
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
  // Number of enabled (non-disabled) sites for the result summary.
  const [enabledSiteCount, setEnabledSiteCount] = useState(sites.length);
  // Abort controller for an in-flight scrape, so closing the modal (or a client
  // timeout) can cancel the request instead of leaving a dangling promise that
  // resolves later and pops a stale result/error onto the freshly reset form.
  const abortRef = useRef<AbortController | null>(null);
  // Creative presets — local overrides on top of the server-fetched profiles so
  // created/edited/deleted presets show immediately without a page fetch.
  const [presetName, setPresetName] = useState('');
  const [presetTargetId, setPresetTargetId] = useState<string>('');
  const [localPresets, setLocalPresets] = useState<Record<string, ProfilePreset[]>>({});
  const [presetSaving, setPresetSaving] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);

  // Effective presets for a profile: local (edited this session) wins over server.
  function presetsFor(p: Profile): ProfilePreset[] {
    return localPresets[p.id] ?? p.presets ?? [];
  }

  async function savePresetTo(targetId: string, name: string) {
    if (!name.trim() || !targetId) return;
    const target = profiles.find((p) => p.id === targetId);
    if (!target) return;
    const existing = presetsFor(target);
    const next: ProfilePreset[] = [...existing];
    const idx = next.findIndex((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    const newPreset: ProfilePreset = {
      id: idx >= 0 ? next[idx].id : (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)),
      name: name.trim(),
      search_terms: searchTerms.split(',').map((s) => s.trim()).filter(Boolean),
      sites: sites.filter((s) => !SITE_OPTIONS.find((o) => o.site === s)?.disabled),
      location: remoteOnly ? 'Remote' : location,
      remote_only: remoteOnly,
      results_wanted: Number(resultsWanted) || 100,
    };
    if (idx >= 0) next[idx] = newPreset; else next.push(newPreset);
    setPresetSaving(true);
    setPresetError(null);
    try {
      const res = await fetch(`/api/presets/${targetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presets: next }),
      });
      if (!res.ok) throw new Error('Failed to save preset');
      setLocalPresets((m) => ({ ...m, [targetId]: next }));
      setPresetName('');
    } catch (e) {
      setPresetError(e instanceof Error ? e.message : 'Failed to save preset');
    } finally {
      setPresetSaving(false);
    }
  }

  async function deletePreset(targetId: string, presetId: string) {
    const target = profiles.find((p) => p.id === targetId);
    if (!target) return;
    const next = presetsFor(target).filter((x) => x.id !== presetId);
    try {
      const res = await fetch(`/api/presets/${targetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presets: next }),
      });
      if (!res.ok) throw new Error('Failed to delete preset');
      setLocalPresets((m) => ({ ...m, [targetId]: next }));
    } catch (e) {
      setPresetError(e instanceof Error ? e.message : 'Failed to delete preset');
    }
  }

  // Reset the form to defaults every time the modal is opened, so a fresh
  // Refill pops up clean (no stale sites/terms/result from the last run).
  useEffect(() => {
    if (open) {
      // Cancel any scrape still running from a previous open so its result
      // can't land on the freshly reset form.
      abortRef.current?.abort();
      abortRef.current = null;
      setSites(['linkedin', 'builtin', 'greenhouse', 'workingnomads', 'jobicy']);
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

  // Load a named preset for a profile into the form (search terms + sites +
  // remote/location + results). Lets admins refill a profile with one click.
  function applyPreset(preset: ProfilePreset | undefined | null) {
    if (!preset) return;
    setSearchTerms(preset.search_terms.join(', '));
    if (Array.isArray(preset.sites) && preset.sites.length) setSites(preset.sites);
    setLocation(preset.location ?? 'United States');
    setRemoteOnly(preset.remote_only ?? true);
    if (preset.results_wanted) setResultsWanted(String(preset.results_wanted));
  }

  async function submit() {
    if (loading) return; // guard against double-clicks racing two scrapes
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const token = setTimeout(() => controller.abort('timeout'), SCRAPE_TIMEOUT_MS);
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
        signal: controller.signal,
      });
      // A stale scrape resolving after the modal was re-opened should not touch
      // the current form state.
      if (controller.signal.aborted) return;
      // Check res.ok BEFORE res.json(): a non-OK response may be an HTML
      // error page (proxy/500), and calling .json() on that throws the
      // "Unexpected token '<'" TypeError we want to avoid.
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || 'Scrape failed');
      }
      // Parse defensively so even a 200-with-no-body / proxy HTML body can't
      // throw "Unexpected token '<'". Validate the shape before trusting it.
      const data = (await res.json().catch(() => null)) ?? {};
      if (typeof data.jobs_added !== 'number' || typeof data.jobs_found !== 'number') {
        throw new Error('Scrape request failed to return results. Please try again.');
      }
      setResult({ jobs_found: data.jobs_found, jobs_added: data.jobs_added });
      setEnabledSiteCount(enabledSites.length);
      // Fire the soft-update so the Applications table updates in place.
      onDone?.({ jobs_added: data.jobs_added });
      // Auto-close after a beat so the user sees the result.
      setTimeout(() => onClose(), 1200);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setError(
          'The scrape took too long and was stopped. Check the Scrape Run History for partial results, then try again.'
        );
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError('Unknown error');
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
            {result.jobs_found} found across {enabledSiteCount} {enabledSiteCount === 1 ? 'site' : 'sites'} ·
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

          <Field label="Presets (one-click refill)">
            <p className="text-xs text-navy-500 mb-2">
              Click a preset to auto-fill this profile&apos;s search terms, sites, and remote filter. Save the current form as a preset below so you can reuse it later.
            </p>
            {profiles.flatMap((p) =>
              presetsFor(p).map((pr) => (
                <span key={pr.id} className="inline-flex items-center gap-1.5 mr-2 mb-2">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      if (!profileIds.includes(p.id)) setProfileIds((ids) => [...ids, p.id]);
                      applyPreset(pr);
                    }}
                    title={`${p.name}: ${pr.search_terms.length} terms`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-navy-800 text-navy-200 hover:bg-brand-green/30 hover:text-white"
                  >
                    <span className="text-brand-green">●</span> {p.name}: {pr.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePreset(p.id, pr.id)}
                    title={`Delete preset ${pr.name}`}
                    aria-label={`Delete preset ${pr.name}`}
                    className="p-1 rounded text-navy-500 hover:text-red-400 hover:bg-red-500/10"
                  >
                    ×
                  </button>
                </span>
              ))
            )}
            {/* Create / save a preset from the current form */}
            <div className="mt-3 pt-3 border-t border-navy-800 flex flex-wrap items-end gap-2">
              <div className="min-w-[150px] flex-1">
                <label className="text-xs text-navy-500 block mb-1">Save current form as a preset</label>
                <select
                  value={presetTargetId}
                  onChange={(e) => setPresetTargetId(e.target.value)}
                  disabled={presetSaving}
                  className="w-full bg-navy-950 border border-navy-700 rounded-md px-2.5 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
                >
                  <option value="">For which profile…</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); savePresetTo(presetTargetId, presetName); } }}
                placeholder="Name (e.g. Backend remote)"
                disabled={presetSaving}
                className="flex-1 min-w-[140px] bg-navy-950 border border-navy-700 rounded-md px-2.5 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-green"
              />
              <button
                type="button"
                disabled={presetSaving || !presetTargetId || !presetName.trim()}
                onClick={() => savePresetTo(presetTargetId, presetName)}
                className="px-3 py-2 text-sm rounded-md bg-brand-green text-navy-950 font-medium hover:bg-brand-greenDark disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {presetSaving ? 'Saving…' : 'Save preset'}
              </button>
            </div>
            {presetError && <p className="text-xs text-red-400 mt-2">{presetError}</p>}
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

          <div className="flex items-center gap-2">
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

          <div className="flex items-center gap-2">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
