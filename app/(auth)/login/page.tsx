'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Spinner, Check } from '@/components/Icon';

// Login — split-screen with a brand/pipeline panel. The form keeps the exact
// Auth.js credentials flow (signIn redirect:false -> router.push('/')).
// The right "pipeline" panel is an honest structural encoding of what Job
// Bidder IS: fresh remote supply -> AI-tailored resume -> applied to the real
// posting, tracked for the client. Built on the app's navy + accent system
// (CSS variables), so it inherits the user's chosen accent color.

const PIPELINE_STEPS = [
  {
    n: '01',
    title: 'Fresh roles, sourced for you',
    body: 'Verified remote postings pulled into your queue — refilled automatically, deduped, and fit-filtered to the role.',
  },
  {
    n: '02',
    title: 'Tailored by AI',
    body: 'Each resume is rewritten to match the exact job description — real experience, never fabricated.',
  },
  {
    n: '03',
    title: 'Applied & tracked',
    body: 'Submissions and follow-ups logged per client, with live weekly progress and earnings in the pool.',
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await signIn('credentials', { redirect: false, email, password });
      if (res?.error) {
        setError('Invalid email or password.');
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('Unable to sign in. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ---- Form side ---- */}
      <div className="flex items-center justify-center px-6 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3">
            <LogoMark />
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-navy-500">Job Bidder</div>
              <div className="text-xs text-navy-300 font-medium">Application agency OS</div>
            </div>
          </div>

          <h1 className="text-2xl font-semibold text-navy-100 tracking-tight">Sign in</h1>
          <p className="text-sm text-navy-400 mt-1.5 mb-7">
            Access your workspace to review, tailor, and apply.
          </p>

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="login-email" className="block th-uppercase mb-1.5">Email</label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                disabled={loading}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-navy-950/70 border border-navy-700 rounded-lg px-3.5 py-2.5 text-sm text-navy-100 placeholder:text-navy-500 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition disabled:opacity-60"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="login-password" className="th-uppercase">Password</label>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPw((v) => !v)}
                  className="text-[11px] text-navy-400 hover:text-navy-200 transition"
                >
                  {showPw ? 'Hide' : 'Show'}
                </button>
              </div>
              <input
                id="login-password"
                type={showPw ? 'text' : 'password'}
                autoComplete="current-password"
                required
                disabled={loading}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-navy-950/70 border border-navy-700 rounded-lg px-3.5 py-2.5 text-sm text-navy-100 placeholder:text-navy-500 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition disabled:opacity-60"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="text-sm text-brand-red bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold rounded-lg text-navy-950 bg-[var(--accent)] hover:brightness-110 transition disabled:opacity-50 shadow-lg shadow-[var(--accent-deep)]"
            >
              <Spinner size={16} className={loading ? '' : 'opacity-0'} />
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-8 text-[11px] leading-relaxed text-navy-500">
            Admin, workers, and clients each land in their own workspace.
            Access is granted by your account — not shared credentials.
          </p>
        </div>
      </div>

      {/* ---- Brand / pipeline panel (desktop only) ---- */}
      <div className="hidden lg:flex relative overflow-hidden border-l border-navy-700 bg-navy-900/40">
        {/* ambient accent glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 -right-40 h-[28rem] w-[28rem] rounded-full opacity-[0.16] blur-3xl"
          style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 65%)' }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-48 -left-24 h-96 w-96 rounded-full opacity-10 blur-3xl"
          style={{ background: 'radial-gradient(circle, #58a6ff 0%, transparent 65%)' }}
        />

        <div className="relative z-10 flex flex-col justify-center px-12 xl:px-16 py-12 w-full max-w-xl mx-auto">
          <div className="mb-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-1 text-[11px] font-medium text-[var(--accent)]">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--accent)]" />
              </span>
              Pipeline live
            </div>
          </div>

          <div className="space-y-7">
            {PIPELINE_STEPS.map((s) => (
              <div key={s.n} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-navy-600 bg-navy-850 text-[10px] font-mono text-navy-300">
                    {s.n}
                  </div>
                  <div className="w-px flex-1 bg-gradient-to-b from-navy-700 to-transparent" aria-hidden />
                </div>
                <div className="pb-1">
                  <div className="text-sm font-semibold text-navy-100">{s.title}</div>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-navy-400">{s.body}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 pt-6 border-t border-navy-800">
            <div className="flex gap-6">
              {[
                ['Remote-only', 'strictly verified supply'],
                ['AI-tailored', 'per-posting resumes'],
                ['Tracked', 'weekly progress per client'],
              ].map(([t, d]) => (
                <div key={t}>
                  <div className="flex items-center gap-1.5 text-[13px] font-semibold text-navy-200">
                    <Check size={13} className="text-[var(--accent)]" />
                    {t}
                  </div>
                  <div className="text-[11px] text-navy-500 mt-0.5">{d}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LogoMark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icon.png?v=2"
      alt="Job Bidder"
      className="h-10 w-10 rounded-xl object-contain ring-1 ring-white/15 shadow-lg shadow-black/30"
    />
  );
}