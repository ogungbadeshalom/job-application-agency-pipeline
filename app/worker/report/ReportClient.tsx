'use client';

import { useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { COMPLAINT_CATEGORIES, type User } from '@/lib/types';

const CATEGORY_LABELS: Record<string, string> = {
  bug: 'Bug / something broke',
  slow: 'It is slow / freezing',
  login: 'Login / account issue',
  resume: 'Resume / tailoring problem',
  proof: 'Proof capture / submit problem',
  'job-quality': 'Job quality / wrong jobs',
  other: 'Something else',
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

      {done ? (
        <div className="panel p-8 text-center">
          <div className="text-4xl mb-3">✅</div>
          <div className="text-lg font-semibold text-navy-100">Report submitted</div>
          <p className="text-sm text-navy-400 mt-1">
            Thanks — the team has been notified and will take a look.
          </p>
          <button
            onClick={() => { setDone(false); setSubject(''); setDetail(''); setUrl(''); setProfileId(''); setCategory('other'); }}
            className="mt-4 px-4 py-2 text-sm rounded-md bg-navy-800 text-navy-200 hover:bg-navy-750"
          >
            Report another
          </button>
        </div>
      ) : (
        <div className="panel p-5 space-y-4 max-w-xl">
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
    </DashboardLayout>
  );
}