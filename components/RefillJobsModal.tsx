'use client';

import { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import { Check, Close, Spinner } from './Icon';
import type { Profile, ProfilePreset } from '@/lib/types';

const SCRAPE_TIMEOUT_MS = 600_000; // 10 min — generous ceiling for JobSpy

// Working job boards for this deployment (non-flaky).
export const SITE_OPTIONS: { name: string; site: string }[] = [
  { name: 'Greenhouse', site: 'greenhouse' },
  { name: 'BuiltIn', site: 'builtin' },
  { name: 'Ashby', site: 'ashby' },
  { name: 'Lever', site: 'lever' },
  { name: 'SmartRecruiters', site: 'smartrecruiters' },
  { name: 'Jobicy', site: 'jobicy' },
  { name: 'Dice', site: 'dice' },
  { name: 'Workable', site: 'workable' },
  { name: 'Remotive', site: 'remotive' },
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
  const [profileIds, setProfileIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ jobs_found: number; jobs_added: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ step: number; totalSteps: number; current: string; jobsFound: number; log?: { site: string; term: string; count: number; status?: string }[] } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Presets: one-click refill + save the current form as a reusable preset.
  const [presetName, setPresetName] = useState('');
  const [presetTargetId, setPresetTargetId] = useState<string>('');
  const [localPresets, setLocalPresets] = useState<Record<string, ProfilePreset[]>>({});
  const [presetBusy, setPresetBusy] = useState(false);

  function presetsFor(p: Profile): ProfilePreset[] {
    return localPresets[p.id] ?? p.presets ?? [];
  }

  const hasPresets = profiles.some((p) => presetsFor(p).length > 0);

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
            setProgress({
              step: p.step ?? 0,
              totalSteps: p.totalSteps,
              current: p.current ?? '',
              jobsFound: p.jobsFound ?? 0,
              log: p.log,
            });
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
      setProfileIds([]); // start with none selected — pick profiles or a preset
      setLoading(false);
      setResult(null);
      setError(null);
      setProgress(null);
    }
  }, [open, profiles]);

  function toggle(list: string[], set: (v: string[]) => void, value: string) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function applyPreset(preset: ProfilePreset | null | undefined) {
    if (!preset) return;
    setSearchTerms(preset.search_terms.join(', '));
    if (Array.isArray(preset.sites) && preset.sites.length) setSites(preset.sites);
    if (preset.remote_only) {
      setRemoteOnly(true);
    } else if (preset.location) {
      setRemoteOnly(false);
      setLocation(preset.location);
    }
    if (preset.results_wanted) setResultsWanted(String(preset.results_wanted));
  }

  async function savePreset() {
    if (!presetName.trim() || !presetTargetId) return;
    const target = profiles.find((p) => p.id === presetTargetId);
    if (!target) return;
    const existing = presetsFor(target);
    setPresetBusy(true);
    try {
      const next: ProfilePreset[] = [...existing];
      const idx = next.findIndex((x) => x.name.toLowerCase() === presetName.trim().toLowerCase());
      const newPreset: ProfilePreset = {
        id: idx >= 0 ? next[idx].id : (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)),
        name: presetName.trim(),
        search_terms: searchTerms.split(',').map((s) => s.trim()).filter(Boolean),
        sites,
        location: remoteOnly ? 'Remote' : location,
        remote_only: remoteOnly,
        results_wanted: Number(resultsWanted) || 100,
      };
      if (idx >= 0) next[idx] = newPreset; else next.push(newPreset);
      const res = await fetch(`/api/presets/${presetTargetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presets: next }),
      });
      if (!res.ok) throw new Error('Failed to save preset');
      setLocalPresets((m) => ({ ...m, [presetTargetId]: next }));
      setPresetName('');
      setPresetTargetId('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save preset');
    } finally {
      setPresetBusy(false);
    }
  }

  async function deletePreset(profileId: string, presetId: string) {
    const target = profiles.find((p) => p.id === profileId);
    if (!target) return;
    const next = presetsFor(target).filter((x) => x.id !== presetId);
    try {
      const res = await fetch(`/api/presets/${profileId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presets: next }),
      });
      if (!res.ok) throw new Error('Failed to delete preset');
      setLocalPresets((m) => ({ ...m, [profileId]: next }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete preset');
    }
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
      setTimeout(() => onClose(), 2600);
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

  // One-line summary of what a Run will do, shown in the footer.
  const whoLabel =
    profileIds.length === 1
      ? profiles.find((p) => p.id === profileIds[0])?.name?.trim()
      : profileIds.length > 1
        ? `${profileIds.length} clients`
        : null;
  const runSummary = [
    whoLabel,
    `${sites.length} ${sites.length === 1 ? 'board' : 'boards'}`,
    remoteOnly ? 'remote only' : location || 'any location',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Refill Jobs"
      subtitle="Scrape fresh postings into the queue."
      wide
      footer={
        result ? (
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-[filter] hover:brightness-110"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))' }}
          >
            Done
          </button>
        ) : (
          <>
            {!loading && (
              <span className="mr-auto truncate text-xs text-navy-500">
                {profileIds.length === 0 ? 'Select at least one client to run.' : runSummary}
              </span>
            )}
            <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md text-navy-300 hover:bg-navy-800">
              {loading ? 'Hide' : 'Cancel'}
            </button>
            <button
              onClick={submit}
              disabled={loading || profileIds.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white shadow-[0_6px_18px_-6px_var(--accent-glow)] transition-[filter] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))' }}
            >
              {loading ? <Spinner /> : null}
              {loading ? 'Scraping…' : 'Run scrape'}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="py-6 text-center">
          <div
            className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <Check size={22} />
          </div>
          <p className="font-mono text-3xl font-bold tracking-tight text-navy-50">+{result.jobs_added}</p>
          <p className="mt-0.5 text-sm text-navy-300">
            new {result.jobs_added === 1 ? 'job' : 'jobs'} added to the queue
          </p>
          <p className="mt-2 text-xs text-navy-500">
            {result.jobs_found} found across {sites.length} {sites.length === 1 ? 'board' : 'boards'} · duplicates skipped by URL
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* ---- Clients ---- */}
          <section>
            <SectionLabel>Who is this refill for</SectionLabel>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {profiles.map((p) => {
                const active = profileIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(profileIds, setProfileIds, p.id)}
                    aria-pressed={active}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      active
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                        : 'border-navy-700 bg-navy-900/50 hover:border-navy-500'
                    }`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        active ? 'text-navy-950' : 'bg-navy-800 text-navy-300'
                      }`}
                      style={active ? { background: 'var(--accent)' } : undefined}
                    >
                      {active ? <Check size={13} /> : p.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className={`truncate text-sm ${active ? 'font-medium text-white' : 'text-navy-200'}`}>
                      {p.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ---- Presets ---- */}
          {hasPresets && (
            <section>
              <SectionLabel hint="one click fills the form + targets that client">Quick refill</SectionLabel>
              <div className="space-y-1.5">
                {profiles.flatMap((p) =>
                  presetsFor(p).length ? (
                    <div key={p.id} className="flex flex-wrap items-center gap-1.5">
                      <span className="w-24 truncate text-[11px] font-mono uppercase tracking-wider text-navy-500">
                        {p.name}
                      </span>
                      {presetsFor(p).map((pr) => (
                        <span
                          key={pr.id}
                          className="inline-flex items-center overflow-hidden rounded-md border border-navy-700 bg-navy-900"
                        >
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => {
                              // Target ONLY this profile when a preset is chosen —
                              // clears the all-selected default so just this chip
                              // highlights and the scrape runs for this client alone.
                              setProfileIds([p.id]);
                              applyPreset(pr);
                            }}
                            title={`${pr.search_terms.length} search terms`}
                            className="px-2.5 py-1 text-xs text-navy-200 transition-colors hover:bg-[var(--accent-soft)] hover:text-white disabled:opacity-50"
                          >
                            {pr.name}
                          </button>
                          <button
                            type="button"
                            onClick={() => deletePreset(p.id, pr.id)}
                            title={`Delete ${pr.name}`}
                            aria-label={`Delete ${pr.name}`}
                            className="h-full px-1.5 text-navy-600 transition-colors hover:bg-red-500/10 hover:text-red-400"
                          >
                            <Close size={11} />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null
                )}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <select
                  value={presetTargetId}
                  onChange={(e) => setPresetTargetId(e.target.value)}
                  disabled={presetBusy}
                  className="rounded-md border border-navy-700 bg-navy-950 px-2 py-1.5 text-xs text-navy-100 focus:border-[var(--accent)] focus:outline-none"
                >
                  <option value="">Save current form as…</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <input
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); savePreset(); } }}
                  placeholder="Preset name"
                  disabled={presetBusy}
                  className="min-w-[130px] flex-1 rounded-md border border-navy-700 bg-navy-950 px-2.5 py-1.5 text-xs text-navy-100 placeholder:text-navy-600 focus:border-[var(--accent)] focus:outline-none"
                />
                <button
                  type="button"
                  disabled={presetBusy || !presetTargetId || !presetName.trim()}
                  onClick={savePreset}
                  className="rounded-md border border-navy-700 px-2.5 py-1.5 text-xs font-medium text-navy-200 transition-colors hover:border-[var(--accent)] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {presetBusy ? 'Saving…' : 'Save preset'}
                </button>
              </div>
            </section>
          )}

          {/* ---- Search ---- */}
          <section>
            <SectionLabel>Search</SectionLabel>
            <div className="space-y-3">
              <div>
                <input
                  value={searchTerms}
                  onChange={(e) => setSearchTerms(e.target.value)}
                  placeholder="backend engineer, platform engineer"
                  className="w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2 text-sm text-navy-100 placeholder:text-navy-600 focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/40"
                />
                <p className="mt-1 text-xs text-navy-500">
                  Comma-separated. Leave blank to use each client&apos;s saved search terms.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={remoteOnly}
                onClick={() => setRemoteOnly(!remoteOnly)}
                className="flex items-center gap-2.5"
              >
                <span
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                    remoteOnly ? '' : 'bg-navy-700'
                  }`}
                  style={remoteOnly ? { background: 'var(--accent)' } : undefined}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                      remoteOnly ? 'left-[18px]' : 'left-0.5'
                    }`}
                  />
                </span>
                <span className="text-sm text-navy-200">
                  Remote only{remoteOnly ? <span className="text-navy-500"> — location ignored</span> : ''}
                </span>
              </button>
              {!remoteOnly && (
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="City, state or country"
                  className="w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2 text-sm text-navy-100 placeholder:text-navy-600 focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/40"
                />
              )}
            </div>
          </section>

          {/* ---- Volume ---- */}
          <section>
            <SectionLabel>Volume &amp; freshness</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    value={resultsWanted}
                    onChange={(e) => setResultsWanted(e.target.value)}
                    placeholder="100"
                    className="w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2 pr-14 text-sm text-navy-100 placeholder:text-navy-600 focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/40"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-navy-500">per term</span>
                </div>
                <p className="mt-1 text-xs text-navy-500">Results wanted, per board per term.</p>
              </div>
              <div>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    value={hoursOld}
                    onChange={(e) => setHoursOld(e.target.value)}
                    placeholder="72"
                    className="w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2 pr-12 text-sm text-navy-100 placeholder:text-navy-600 focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/40"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-navy-500">hrs old</span>
                </div>
                <p className="mt-1 text-xs text-navy-500">Only postings newer than this.</p>
              </div>
            </div>
          </section>

          {/* ---- Boards ---- */}
          <section>
            <SectionLabel>Boards</SectionLabel>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSites(SITE_OPTIONS.map((o) => o.site))}
                className="rounded-full border border-navy-600 px-2.5 py-1 text-xs text-navy-300 transition-colors hover:border-[var(--accent)] hover:text-navy-100"
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setSites([])}
                className="rounded-full border border-navy-600 px-2.5 py-1 text-xs text-navy-300 transition-colors hover:border-navy-400 hover:text-navy-100"
              >
                None
              </button>
              <span className="mx-0.5 h-4 w-px bg-navy-700" aria-hidden />
              {SITE_OPTIONS.map((opt) => {
                const active = sites.includes(opt.site);
                return (
                  <button
                    key={opt.site}
                    type="button"
                    onClick={() => toggle(sites, setSites, opt.site)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      active
                        ? 'border-[var(--accent)]/50 bg-[var(--accent-soft)] text-white'
                        : 'border-navy-700 bg-navy-900 text-navy-400 hover:border-navy-500'
                    }`}
                  >
                    {active && <Check size={11} />}
                    {opt.name}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ---- Live run console ---- */}
          {loading && (
            <section className="overflow-hidden rounded-xl border border-[var(--accent)]/30 bg-navy-950" aria-live="polite">
              <div className="flex items-center justify-between gap-3 border-b border-navy-800 px-3.5 py-2.5">
                <span className="flex min-w-0 items-center gap-2 font-mono text-xs text-navy-300">
                  <Spinner size={13} />
                  <span className="truncate">{progress?.current || 'Starting…'}</span>
                </span>
                <span className="shrink-0 font-mono text-xs text-navy-500">
                  {progress ? `${progress.step}/${progress.totalSteps}` : '—'} · {progress?.jobsFound ?? 0} jobs
                </span>
              </div>
              <div className="h-[3px] bg-navy-800">
                <div
                  className="h-full transition-all duration-500"
                  style={{
                    width: progress && progress.totalSteps > 0 ? `${Math.min(100, ((progress.step + 1) / progress.totalSteps) * 100)}%` : '4%',
                    background: 'linear-gradient(90deg, var(--accent), var(--accent-strong))',
                  }}
                />
              </div>
              {progress?.log && progress.log.length > 0 && (
                <div className="max-h-36 overflow-y-auto divide-y divide-navy-800/60">
                  {progress.log.slice(-6).map((l, i) => {
                    const failed = !!l.status && l.status !== 'ok';
                    return (
                      <div key={i} className="flex items-center justify-between gap-3 px-3.5 py-1.5 font-mono text-[11px]">
                        <span className="truncate text-navy-400">{l.site} — {l.term}</span>
                        <span className={`shrink-0 ${failed ? 'text-red-400' : 'text-[var(--accent)]'}`}>
                          {failed ? `✕ ${String(l.status).replace('failed — ', '')}` : `${l.count} found`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="border-t border-navy-800/60 px-3.5 py-2 text-[11px] text-navy-500">
                You can hide this — the run keeps going. Check Scrape Run History for the result.
              </p>
            </section>
          )}

          {/* ---- Error ---- */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
              <span aria-hidden>⚠</span>
              <span>{error}</span>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function SectionLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <label className="text-[10px] font-mono uppercase tracking-[0.14em] text-navy-500">{children}</label>
      {hint && <span className="truncate text-[11px] text-navy-600">{hint}</span>}
    </div>
  );
}
