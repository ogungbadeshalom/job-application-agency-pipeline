'use client';

import { useState } from 'react';
import Modal from './Modal';
import { Spinner } from './Icon';
import type { Profile } from '@/lib/types';

export const EXP_SITES = [
  { name: 'Greenhouse', site: 'greenhouse' },
  { name: 'BuiltIn', site: 'builtin' },
  { name: 'Remotive', site: 'remotive' },
  { name: 'WorkingNomads', site: 'workingnomads' },
  { name: 'RemoteOK', site: 'remoteok' },
  { name: 'Indeed', site: 'indeed' },
  { name: 'LinkedIn', site: 'linkedin' },
  { name: 'HiringCafe', site: 'hiringcafe' },
  { name: 'Jobicy', site: 'jobicy' },
];

// Only exclude clear ON-SITE markers — never a role/stack whitelist, so the
// user's own search terms drive results. The remote_only backend filter handles
// location; this just vetoes obvious office-only words in job descriptions.
function expExclude(remoteOnly: boolean): string[] {
  return remoteOnly
    ? ['onsite', 'on-site', 'office-based', 'in-office', 'must work in-office', 'hybrid']
    : [];
}

// EXPERIMENTAL — run a scrape and export the raw results to a spreadsheet for
// inspection. Does NOT insert into the queue. May be removed later.
export default function ExperimentalExportModal({
  open,
  onClose,
  profiles,
}: {
  open: boolean;
  onClose: () => void;
  profiles: Profile[];
}) {
  // top 6 reliably-working boards ticked by default; hiringcafe/others opt-in
  const [sites, setSites] = useState<string[]>(
    ['indeed', 'builtin', 'remoteok', 'jobicy', 'remotive', 'workingnomads']
  );
  const [searchTerms, setSearchTerms] = useState('');
  const [remoteOnly, setRemoteOnly] = useState(true);
  const [results, setResults] = useState('50');
  const [loading, setLoading] = useState(false);
  const [useProfilePreset, setUseProfilePreset] = useState('');
  const [error, setError] = useState<string | null>(null);

  function applyPreset() {
    if (!useProfilePreset) return;
    const p = profiles.find((x) => x.id === useProfilePreset);
    if (!p) return;
    const pr = (p.presets ?? [])[0];
    if (pr) {
      setSearchTerms(pr.search_terms.join(', '));
      if (Array.isArray(pr.sites) && pr.sites.length) setSites(pr.sites.filter((s) => EXP_SITES.some((o) => o.site === s)));
      setRemoteOnly(pr.remote_only ?? true);
      if (pr.results_wanted) setResults(String(pr.results_wanted));
    }
  }

  async function runExport() {
    if (loading) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/scrape/experimental', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sites,
          search_terms: searchTerms.split(',').map((s) => s.trim()).filter(Boolean),
          location: remoteOnly ? 'Remote' : 'United States',
          remote_only: remoteOnly,
          results_wanted: Number(results) || 50,
          hours_old: 168,
          include_kw: [],
          exclude_kw: expExclude(remoteOnly),
          remove_easy_apply: true,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jobs-export-${Date.now()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} wide title="Experimental — export jobs to spreadsheet">
      <div className="space-y-4">
        <p className="text-xs text-amber-300/80 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
          ⚗️ <b>Experimental</b> — this scrapes live boards and downloads a spreadsheet of the raw results.
          It does <b>not</b> add anything to any queue. May be removed later.
        </p>

        {profiles.length > 0 && (
          <div>
            <label className="text-xs text-navy-400 block mb-1">Load a preset (optional)</label>
            <select value={useProfilePreset} onChange={(e) => { setUseProfilePreset(e.target.value); }} onBlur={applyPreset} className="w-full bg-navy-950 border border-navy-700 rounded-md px-2.5 py-2 text-sm text-navy-100">
              <option value="">Load preset from a profile…</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="text-xs text-navy-400 block mb-1">Search terms (comma-separated)</label>
          <input value={searchTerms} onChange={(e) => setSearchTerms(e.target.value)}
            placeholder="Senior Data Engineer, Data Platform Engineer"
            className="w-full bg-navy-950 border border-navy-700 rounded-md px-2.5 py-2 text-sm text-navy-100" />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-navy-400">Sites:</span>
          {EXP_SITES.map((s) => (
            <label key={s.site} className="inline-flex items-center gap-1.5 text-sm text-navy-200">
              <input type="checkbox" checked={sites.includes(s.site)}
                onChange={() => setSites((v) => v.includes(s.site) ? v.filter((x) => x !== s.site) : [...v, s.site])} />
              {s.name}
            </label>
          ))}
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <label className="inline-flex items-center gap-1.5 text-sm text-navy-200">
            <input type="checkbox" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} /> Remote only
          </label>
          <div>
            <label className="text-xs text-navy-400 mr-2">Results</label>
            <input value={results} onChange={(e) => setResults(e.target.value)} className="w-20 bg-navy-950 border border-navy-700 rounded-md px-2 py-1.5 text-sm text-navy-100" />
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end pt-2 border-t border-navy-800">
          <button onClick={runExport} disabled={loading || !sites.length || !searchTerms.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-amber-500/20 text-amber-200 border border-amber-500/30 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed">
            {loading ? <><Spinner /> Scraping to spreadsheet…</> : '⬇ Export to spreadsheet'}
          </button>
        </div>
      </div>
    </Modal>
  );
}