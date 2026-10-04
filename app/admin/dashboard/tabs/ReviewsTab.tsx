'use client';

// ReviewsTab — admin moderation for landing-page reviews.
// Approve / reject / feature / edit / delete. Pending count passed from parent.

import { useEffect, useState } from 'react';

type AdminReview = {
  id: string;
  userId: string | null;
  name: string;
  roleLabel: string | null;
  stars: number;
  ratingCommunication: number | null;
  ratingSpeed: number | null;
  ratingResults: number | null;
  body: string;
  status: 'pending' | 'approved' | 'rejected';
  verified: boolean;
  featured: boolean;
  createdAt: string;
};

export default function ReviewsTab() {
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/reviews/admin');
      const d = await r.json();
      setReviews(d.reviews ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function patch(id: string, update: { status?: string; featured?: boolean; body?: string }) {
    await fetch('/api/reviews/admin', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...update }),
    });
    load();
  }

  async function remove(id: string) {
    if (!confirm('Delete this review permanently?')) return;
    await fetch(`/api/reviews/admin?id=${id}`, { method: 'DELETE' });
    load();
  }

  const shown = reviews.filter((r) => filter === 'all' || r.status === filter);
  const counts = {
    pending: reviews.filter((r) => r.status === 'pending').length,
    approved: reviews.filter((r) => r.status === 'approved').length,
    rejected: reviews.filter((r) => r.status === 'rejected').length,
  };

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div>
          <h2 className="text-xl font-bold text-white">Reviews</h2>
          <p className="text-sm text-white/40">Moderate client &amp; external testimonials for the landing page.</p>
        </div>
        <div className="flex gap-1.5">
          {(['pending', 'approved', 'rejected', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                filter === f ? 'bg-[var(--accent-soft)] text-white' : 'text-white/50 hover:text-white hover:bg-white/5'
              }`}
            >
              {f} {f !== 'all' && counts[f] > 0 && <span className="opacity-60">({counts[f]})</span>}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-white/40">Loading reviews…</p>
      ) : shown.length === 0 ? (
        <p className="text-white/40">No {filter === 'all' ? '' : filter + ' '}reviews.</p>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => (
            <article
              key={r.id}
              className={`rounded-xl border p-4 ${
                r.status === 'pending' ? 'border-amber-500/40 bg-amber-500/[0.04]' : 'border-white/10 bg-white/[0.02]'
              }`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-semibold">{r.name}</span>
                    {r.verified && (
                      <span className="rounded-full bg-[var(--accent)]/15 text-[var(--accent-strong,var(--accent))] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                        ✓ Verified (has account)
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        r.status === 'approved'
                          ? 'bg-[var(--accent)]/15 text-[var(--accent-strong,var(--accent))]'
                          : r.status === 'rejected'
                          ? 'bg-red-500/15 text-red-400'
                          : 'bg-amber-500/15 text-amber-400'
                      }`}
                    >
                      {r.status}
                    </span>
                    {r.featured && (
                      <span className="rounded-full bg-white/10 text-white/70 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                        ★ Featured
                      </span>
                    )}
                  </div>
                  <div className="text-sm mt-1">
                    <span className="text-[var(--accent-strong,var(--accent))] tracking-wide">{'★'.repeat(r.stars)}</span>
                    <span className="text-white/20">{'★'.repeat(5 - r.stars)}</span>
                    {r.roleLabel && <span className="text-white/40"> · {r.roleLabel}</span>}
                    <span className="text-white/25"> · {new Date(r.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {r.status !== 'approved' && (
                    <button onClick={() => patch(r.id, { status: 'approved' })} className="px-2.5 py-1 rounded-md text-xs bg-[var(--accent)]/15 text-[var(--accent-strong,var(--accent))] hover:bg-[var(--accent)]/25">
                      Approve
                    </button>
                  )}
                  {r.status !== 'rejected' && (
                    <button onClick={() => patch(r.id, { status: 'rejected' })} className="px-2.5 py-1 rounded-md text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20">
                      Reject
                    </button>
                  )}
                  <button
                    onClick={() => patch(r.id, { featured: !r.featured })}
                    className="px-2.5 py-1 rounded-md text-xs bg-white/5 text-white/60 hover:text-white hover:bg-white/10"
                  >
                    {r.featured ? 'Unfeature' : 'Feature'}
                  </button>
                  {editing === r.id ? (
                    <>
                      <button
                        onClick={() => { patch(r.id, { body: editText }); setEditing(null); }}
                        className="px-2.5 py-1 rounded-md text-xs bg-white/10 text-white hover:bg-white/20"
                      >
                        Save
                      </button>
                      <button onClick={() => setEditing(null)} className="px-2.5 py-1 rounded-md text-xs text-white/40 hover:text-white">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => { setEditing(r.id); setEditText(r.body); }}
                      className="px-2.5 py-1 rounded-md text-xs bg-white/5 text-white/60 hover:text-white hover:bg-white/10"
                    >
                      Edit
                    </button>
                  )}
                  <button onClick={() => remove(r.id)} className="px-2.5 py-1 rounded-md text-xs text-red-400/70 hover:text-red-300 hover:bg-red-500/10">
                    Delete
                  </button>
                </div>
              </div>
              {editing === r.id ? (
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={4}
                  className="mt-3 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[var(--accent)]"
                />
              ) : (
                <p className="text-white/80 text-sm leading-relaxed mt-3">{r.body}</p>
              )}
              {(r.ratingCommunication || r.ratingSpeed || r.ratingResults) && (
                <p className="text-white/35 text-xs mt-2">
                  {r.ratingCommunication ? `Communication ${r.ratingCommunication}/5 · ` : ''}
                  {r.ratingSpeed ? `Speed ${r.ratingSpeed}/5 · ` : ''}
                  {r.ratingResults ? `Results ${r.ratingResults}/5` : ''}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
