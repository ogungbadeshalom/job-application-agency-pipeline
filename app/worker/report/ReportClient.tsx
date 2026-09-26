'use client';

import { useCallback, useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { COMPLAINT_CATEGORIES, type Complaint, type User } from '@/lib/types';

const CATEGORY_LABELS: Record<string, string> = {
  bug: 'Bug / something broke',
  slow: 'It is slow / freezing',
  login: 'Login / account issue',
  resume: 'Resume / tailoring problem',
  proof: 'Proof capture / submit problem',
  'job-quality': 'Job quality / wrong jobs',
  other: 'Something else',
};

const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  open: { label: 'Open', cls: 'bg-blue-500/15 text-blue-300 border-blue-500/30', dot: 'bg-blue-400' },
  in_progress: { label: 'In progress', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30', dot: 'bg-amber-400' },
  resolved: { label: 'Resolved', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', dot: 'bg-emerald-400' },
  wontfix: { label: 'Won\u2019t fix', cls: 'bg-navy-800 text-navy-400 border-navy-700', dot: 'bg-navy-500' },
};

export default function ReportClient({
  user,
  nav,
  profiles,
}: {
  user: User;
  nav: { href: string; label: string }[];
  profiles: { id: string; name: string }[];
}) {
  const [category, setCategory] = useState('other');
  const [subject, setSubject] = useState('');
  const [detail, setDetail] = useState('');
  const [profileId, setProfileId] = useState('');
  const [url, setUrl] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<Complaint[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/complaints?mine=1');
      if (!res.ok) throw new Error('Could not load your reports');
      const data = await res.json();
      setHistory(Array.isArray(data.complaints) ? data.complaints : []);
      setHistoryError(null);
    } catch {
      setHistoryError('Could not load your reports right now.');
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  async function submit() {
    if (!subject.trim() || !detail.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          subject: subject.trim(),
          detail: detail.trim(),
          profile_id: profileId || null,
          url: url.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to submit report');
      setDone(true);
      loadHistory(); // refresh the history list with the new report
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit report');
    } finally {
      setSending(false);
    }
  }

  return (
    <DashboardLayout user={user} nav={nav} active="/worker/report">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-navy-100">Report a problem</h1>
        <p className="text-sm text-navy-400">
          Something broken or slowing you down? Report it and the team will fix it.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* Report form */}
        {done ? (
          <div className="panel p-8 text-center">
            <div className="text-4xl mb-3">✅</div>
            <div className="text-lg font-semibold text-navy-100">Report submitted</div>
            <p className="text-sm text-navy-400 mt-1">
              Thanks — the team has been notified. Track its status in &ldquo;My reports&rdquo; on the right.
            </p>
            <button
              onClick={() => { setDone(false); setSubject(''); setDetail(''); setUrl(''); setProfileId(''); setCategory('other'); }}
              className="mt-4 px-4 py-2 text-sm rounded-md bg-navy-800 text-navy-200 hover:bg-navy-750"
            >
              Report another
            </button>
          </div>
        ) : (
          <div className="panel p-5 space-y-4">
            <div>
              <label className="block th-uppercase mb-1.5">What&apos;s the problem?</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
              >
                {COMPLAINT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block th-uppercase mb-1.5">Short subject</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={200}
                placeholder="e.g. Tailor button freezes on #24"
                className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
              />
            </div>

            <div>
              <label className="block th-uppercase mb-1.5">Details</label>
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={5}
                placeholder="What happened, what did you expect, what were you doing?"
                className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue resize-y"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block th-uppercase mb-1.5">Client (optional)</label>
                <select
                  value={profileId}
                  onChange={(e) => setProfileId(e.target.value)}
                  className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
                >
                  <option value="">Not related to one client</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block th-uppercase mb-1.5">Related job link (optional)</label>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://…"
                  className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
                />
              </div>
            </div>

            {error && (
              <div className="text-sm text-brand-red bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-navy-500">Reports go straight to the dev team.</p>
              <button
                onClick={submit}
                disabled={sending || !subject.trim() || !detail.trim()}
                className="px-4 py-2 text-sm rounded-md bg-brand-greenDark text-white hover:bg-brand-green disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? 'Sending…' : 'Submit report'}
              </button>
            </div>
          </div>
        )}

        {/* My reports history */}
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-navy-700">
            <h3 className="text-sm font-semibold text-navy-200">My reports</h3>
            <span className="text-xs text-navy-500">{history.length} total</span>
          </div>
          <div className="divide-y divide-navy-800">
            {historyError ? (
              <p className="px-4 py-5 text-sm text-navy-400">{historyError}</p>
            ) : history.length === 0 ? (
              <p className="px-4 py-5 text-sm text-navy-500">
                No reports yet. Anything you file will appear here with its status.
              </p>
            ) : (
              history.map((c) => {
                const m = STATUS_META[c.status] ?? STATUS_META.open;
                return (
                  <div key={c.id} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border ${m.cls}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
                        {m.label}
                      </span>
                      <span className="text-[11px] text-navy-500">{new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    </div>
                    <p className="text-sm font-medium text-navy-100 mt-1.5">{c.subject}</p>
                    <p className="text-xs text-navy-400 mt-1 line-clamp-2">{CATEGORY_LABELS[c.category] ?? c.category}</p>
                    {c.admin_note ? (
                      <p className="text-xs text-navy-300 mt-2 bg-navy-900/70 border border-navy-700 rounded-md px-2.5 py-1.5">
                        <span className="font-semibold text-navy-200">Team: </span>
                        {c.admin_note}
                      </p>
                    ) : c.status === 'open' && (
                      <p className="text-xs text-navy-500 mt-2 italic">Waiting for the team to look at this.</p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}