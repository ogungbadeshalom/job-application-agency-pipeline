'use client';

import { useEffect, useState, useCallback } from 'react';
import { Spinner } from '@/components/Icon';

interface Task {
  id: string; profile_id: string; sites: string[]; search_terms: string[];
  status: 'pending'|'claimed'|'done'|'failed'; jobs_found: number; jobs_added: number;
  error_message: string|null; created_at: string;
}

// Admin control for the LAPTOP refill agent: queue residential-only boards
// (Indeed/Glassdoor/ZipRecruiter/LinkedIn) for the laptop to scrape on a
// residential IP, plus manage the agent token + view recent tasks.
export default function LaptopRefillPanel({ profiles }: { profiles: { id: string; name: string }[] }) {
  const [profileId, setProfileId] = useState('');
  const [sites, setSites] = useState<string[]>([]);
  const [terms, setTerms] = useState('data engineer, senior data engineer');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agentTokenSet, setAgentTokenSet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const AGENT_BOARDS = [
    { key: 'indeed', label: 'Indeed' },
    { key: 'glassdoor', label: 'Glassdoor' },
    { key: 'zip_recruiter', label: 'ZipRecruiter' },
    { key: 'linkedin', label: 'LinkedIn' },
    { key: 'remoteok', label: 'RemoteOK' },
  ];

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/scrape-tasks');
      if (!r.ok) return;
      const d = await r.json();
      setTasks(d.tasks || []);
      setAgentTokenSet(!!d.agentTokenSet);
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  async function queue() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const termList = terms.split(',').map((t) => t.trim()).filter(Boolean);
      if (!termList.length) throw new Error('Enter at least one search term.');
      const res = await fetch('/api/scrape-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, sites, searchTerms: termList }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error || `Queue failed (${res.status})`);
      setNotice(d?.message || 'Task queued.');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Queue failed');
    } finally { setBusy(false); }
  }

  async function rotateToken() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch('/api/scrape-tasks', { method: 'PATCH' });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error || 'Rotate failed');
      setNotice('Token rotated. Copy it into the laptop agent\u2019s JOBBIDDER_TOKEN config.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rotate failed');
    } finally { setBusy(false); }
  }

  return (
    <section className="panel overflow-hidden">
      <div className="p-3 border-b border-navy-700 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-navy-200">Laptop refill agent</h3>
        <span className="text-[10px] font-mono text-navy-500">{agentTokenSet ? 'token set ✓' : 'no token — rotate to set'}</span>
      </div>

      <div className="p-4 space-y-4">
        <p className="text-sm text-navy-400 leading-relaxed">
          Queue boards your server&apos;s data-center IP can&apos;t scrape
          (they bot-wall it). Run <code className="text-navy-200">python3 scripts/laptop_agent.py
          </code> on your own machine (residential IP) — it pulls these tasks and
          posts results back. Works whenever the laptop is on; tasks just wait when off.
        </p>

        {/* Queue form */}
        <div className="space-y-3">
          <div>
            <label className="text-xs text-navy-500 block mb-1">Client profile</label>
            <select
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
              className="rounded-md bg-navy-800 border border-navy-700 px-2 py-1.5 text-sm text-navy-100 w-full"
            >
              <option value="">Select profile…</option>
              {(profiles || []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-navy-500 block mb-1">Boards (residential-unlockable)</label>
            <div className="flex flex-wrap gap-2">
              {AGENT_BOARDS.map((b) => (
                <label key={b.key} className="inline-flex items-center gap-1.5 text-sm text-navy-200">
                  <input
                    type="checkbox"
                    checked={sites.includes(b.key)}
                    onChange={(e) => setSites((s) => (e.target.checked ? [...s, b.key] : s.filter((x) => x !== b.key)))}
                    className="accent-[var(--accent)] h-4 w-4"
                  />
                  {b.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-navy-500 block mb-1">Search terms (comma-separated)</label>
            <input
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              className="rounded-md bg-navy-800 border border-navy-700 px-2 py-1.5 text-sm text-navy-100 w-full"
            />
          </div>
          <button
            onClick={queue}
            disabled={busy || !profileId || !sites.length}
            className="px-3 py-1.5 rounded-md bg-brand-green text-navy-950 text-sm font-semibold disabled:opacity-50"
          >
            {busy ? 'Queuing…' : 'Queue for laptop'}
          </button>
          <button
            onClick={rotateToken}
            disabled={busy}
            className="ml-2 px-3 py-1.5 rounded-md bg-navy-800 text-navy-100 text-sm hover:bg-navy-750 disabled:opacity-50"
          >
            Rotate agent token
          </button>
        </div>

        {error && <div className="text-sm text-brand-red">{error}</div>}
        {notice && <div className="text-sm text-brand-green">{notice}</div>}

        {/* Task history */}
        {tasks.length > 0 && (
          <div className="pt-2 border-t border-navy-800">
            <div className="text-xs text-navy-400 mb-2 font-semibold uppercase tracking-wide">Recent tasks</div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {tasks.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 text-xs text-navy-300">
                  <span className="truncate">
                    {t.sites.join('+')} · {(t.search_terms||[]).slice(0,2).join(', ')}
                  </span>
                  <span className={`shrink-0 px-1.5 py-px rounded-full capitalize ${
                    t.status === 'done' ? 'bg-brand-green/15 text-brand-green'
                    : t.status === 'failed' ? 'bg-brand-red/15 text-brand-red'
                    : t.status === 'claimed' ? 'bg-amber-500/15 text-amber-400'
                    : 'bg-navy-800 text-navy-300'
                  }`}>
                    {t.status}
                    {t.status === 'done' && ` · +${t.jobs_added}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}