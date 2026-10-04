'use client';

// ReviewsSection — landing-page testimonials (approved reviews only).
// Fetches /api/reviews (public), renders avg stars + featured row + grid,
// plus a "Write a review" toggle that opens the public form (external
// submitters; logged-in users get the verified badge automatically).

import { useEffect, useState } from 'react';

type Review = {
  id: string;
  name: string;
  roleLabel: string | null;
  stars: number;
  ratingCommunication: number | null;
  ratingSpeed: number | null;
  ratingResults: number | null;
  body: string;
  verified: boolean;
  featured: boolean;
};

function Stars({ n, size = 'sm' }: { n: number; size?: 'sm' | 'lg' }) {
  const cls = size === 'lg' ? 'text-xl' : 'text-sm';
  return (
    <span className={`${cls} tracking-wide`} aria-label={`${n} out of 5 stars`}>
      {'★'.repeat(n)}
      <span className="text-white/20">{'★'.repeat(5 - n)}</span>
    </span>
  );
}

function MiniBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-white/50 w-24 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full bg-[var(--accent,#22C55E)]" style={{ width: `${(value / 5) * 100}%` }} />
      </div>
      <span className="text-[11px] text-white/60 w-7 text-right">{value}</span>
    </div>
  );
}

export default function ReviewsSection() {
  const [data, setData] = useState<{ reviews: Review[]; avg: number; total: number } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', roleLabel: '', stars: 5, body: '', website: '' });
  const [submitState, setSubmitState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    fetch('/api/reviews')
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ reviews: [], avg: 0, total: 0 }));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitState('sending');
    setFormError('');
    try {
      const r = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setFormError(d.error || 'Something went wrong.');
        setSubmitState('error');
        return;
      }
      setSubmitState('done');
    } catch {
      setFormError('Network error — try again.');
      setSubmitState('error');
    }
  }

  const reviews = data?.reviews ?? [];
  const avg = data?.avg ?? 0;
  const total = data?.total ?? 0;
  const featured = reviews.filter((r) => r.featured);
  const rest = reviews.filter((r) => !r.featured);

  return (
    <section id="reviews" className="jb-section">
      <div className="jb-wrap">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--accent,#22C55E)]">Testimonials</div>
            <h2 className="text-2xl font-bold text-white">What clients say</h2>
          </div>
          {total > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2">
              <Stars n={Math.round(avg)} size="lg" />
              <span className="text-white font-semibold">{avg.toFixed(1)}</span>
              <span className="text-white/40 text-sm">· {total} review{total === 1 ? '' : 's'}</span>
            </div>
          )}
        </div>

        {reviews.length === 0 ? (
          <p className="text-white/40 mt-6">No published reviews yet — be the first to share your experience.</p>
        ) : (
          <>
            {featured.length > 0 && (
              <div className="grid gap-4 md:grid-cols-3 mt-8">
                {featured.slice(0, 3).map((r) => (
                  <figure key={r.id} className="rounded-xl border border-[var(--accent,#22C55E)]/40 bg-white/[0.03] p-5">
                    <Stars n={r.stars} />
                    <blockquote className="text-white/90 text-sm leading-relaxed mt-3">{r.body}</blockquote>
                    <figcaption className="mt-4 text-sm">
                      <span className="text-white font-semibold">{r.name}</span>
                      {r.roleLabel && <span className="text-white/40"> · {r.roleLabel}</span>}
                      {r.verified && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[var(--accent,#22C55E)]/15 text-[var(--accent,#22C55E)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                          ✓ Verified client
                        </span>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
            {rest.length > 0 && (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mt-4">
                {rest.map((r) => (
                  <figure key={r.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
                    <Stars n={r.stars} />
                    {(r.ratingCommunication || r.ratingSpeed || r.ratingResults) && (
                      <div className="mt-3 space-y-1.5">
                        {r.ratingCommunication ? <MiniBar label="Communication" value={r.ratingCommunication} /> : null}
                        {r.ratingSpeed ? <MiniBar label="Speed" value={r.ratingSpeed} /> : null}
                        {r.ratingResults ? <MiniBar label="Results" value={r.ratingResults} /> : null}
                      </div>
                    )}
                    <blockquote className="text-white/80 text-sm leading-relaxed mt-3">{r.body}</blockquote>
                    <figcaption className="mt-4 text-sm">
                      <span className="text-white/90 font-medium">{r.name}</span>
                      {r.roleLabel && <span className="text-white/40"> · {r.roleLabel}</span>}
                      {r.verified ? (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[var(--accent,#22C55E)]/15 text-[var(--accent,#22C55E)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                          ✓ Verified client
                        </span>
                      ) : (
                        <span className="ml-2 inline-flex items-center rounded-full bg-white/10 text-white/50 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                          Approved review
                        </span>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </>
        )}

        {/* write-a-review toggle */}
        <div className="mt-8">
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="jb-btn jb-btn-ghost"
            >
              ★ Write a review
            </button>
          ) : submitState === 'done' ? (
            <div className="rounded-xl border border-[var(--accent,#22C55E)]/40 bg-[var(--accent,#22C55E)]/10 p-5 text-white/90 max-w-xl">
              <b>Thanks — your review was submitted.</b>
              <p className="text-white/60 text-sm mt-1">It will appear here once it&apos;s approved by the team.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="rounded-xl border border-white/10 bg-white/[0.03] p-5 max-w-xl space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm text-white/60">
                  Your name *
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white text-sm outline-none focus:border-[var(--accent,#22C55E)]"
                    placeholder="John O."
                  />
                </label>
                <label className="text-sm text-white/60">
                  How we worked together
                  <input
                    value={form.roleLabel}
                    onChange={(e) => setForm({ ...form, roleLabel: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white text-sm outline-none focus:border-[var(--accent,#22C55E)]"
                    placeholder="Client, 2025 — Data roles"
                  />
                </label>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-white/60">Overall rating *</span>
                <div className="flex gap-1 text-2xl">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      type="button"
                      key={n}
                      onClick={() => setForm({ ...form, stars: n })}
                      className={`transition-colors ${n <= form.stars ? 'text-[var(--accent,#22C55E)]' : 'text-white/20 hover:text-white/40'}`}
                      aria-label={`${n} stars`}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </div>
              <label className="block text-sm text-white/60">
                Your review *
                <textarea
                  required
                  minLength={10}
                  rows={4}
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white text-sm outline-none focus:border-[var(--accent,#22C55E)]"
                  placeholder="What was it like working with us?"
                />
              </label>
              {/* honeypot — hidden from humans */}
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                className="hidden"
                aria-hidden="true"
              />
              {formError && <p className="text-red-400 text-sm">{formError}</p>}
              <div className="flex items-center gap-3">
                <button type="submit" disabled={submitState === 'sending'} className="jb-btn jb-btn-solid disabled:opacity-50">
                  {submitState === 'sending' ? 'Sending…' : 'Submit review'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="text-white/40 text-sm hover:text-white/70">
                  Cancel
                </button>
              </div>
              <p className="text-white/30 text-xs">Reviews are checked by the team before they appear on this page.</p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
