'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Role } from '@/lib/types';

// Onboarding walkthrough — a self-contained, slide-based tour.
//
// The previous implementation used react-joyride with DOM element targeting
// and router.push between pages. That design was inherently fragile: the tour
// unmounted on every navigation, polled for anchors with timeouts, and
// depended on event timing — resulting in the tour silently failing to start,
// freezing mid-step, or never resuming after navigation (repeatedly reported
// as "How it works is buggy").
//
// This version renders a single modal walkthrough with role-specific slides.
// It has zero DOM coupling and zero navigation, so it cannot desync from the
// page. Entry points are unchanged:
//   - auto-opens once per role on first login (localStorage seen-key)
//   - re-opens via the "How it works" button (jobbidder:open-onboarding event)
//   - marks done via jobbidder:onboarding-done + localStorage done-key

const STORAGE_KEY = 'jobbidder.onboarding.seen';
const DONE_KEY = 'jobbidder.onboarding.done';
const OPEN_EVENT = 'jobbidder:open-onboarding';

interface Slide {
  icon: string;
  title: string;
  body: string;
  points?: string[];
}

const SLIDES: Record<Role, Slide[]> = {
  worker: [
    {
      icon: '👋',
      title: 'Welcome to your queue',
      body: 'This is your workspace. Fresh remote jobs land here automatically — you tailor, apply, and get paid for proof-attached applications.',
      points: ['Jobs reset weekly', 'Your progress is tracked Mon–Sun'],
    },
    {
      icon: '🎯',
      title: 'Work a job in 3 steps',
      body: 'Open a job from your queue, tailor the resume with AI, then apply on the real site and mark it applied.',
      points: ['Tailor → AI rewrites your resume for that exact posting', 'Apply on the company site', 'Mark Applied + attach proof to get credit'],
    },
    {
      icon: '⚡',
      title: 'Out of work? Refill',
      body: 'The Refill button pulls fresh remote jobs across multiple boards. Add Job lets you paste a link you found yourself.',
      points: ['Duplicates are blocked automatically', 'Auto-tailor runs on every new job'],
    },
    {
      icon: '🛟',
      title: 'Stuck? Report it',
      body: 'Use "Report a problem" in the sidebar for anything broken. You\'ll be able to track its status — open, in progress, resolved — in My Reports.',
    },
    {
      icon: '🚀',
      title: "You're ready",
      body: 'Start with your queue. Tailor your first job and mark it applied when done. Good luck!',
    },
  ],
  client: [
    {
      icon: '👋',
      title: 'Welcome — this is your view',
      body: 'Everything here is read-only. Browse freely — nothing you do can change your applications.',
    },
    {
      icon: '📄',
      title: 'My Applications',
      body: 'Every job we tailored and submitted on your behalf, with the resume and proof of submission for each. Click any row to see the full details.',
    },
    {
      icon: '🗓️',
      title: 'Download past weeks',
      body: 'On the My Applications page you can pick any past week and download a ZIP of every tailored resume from it — handy for your own records.',
    },
    {
      icon: '🧪',
      title: 'Resume Lab',
      body: 'Edit the resume we work from, pick a design, and preview live. Save once and it powers all future tailored resumes.',
    },
    {
      icon: '🚀',
      title: "You're set",
      body: 'Check My Applications for the latest submissions, or visit History for the full week-by-week record.',
    },
  ],
  admin: [
    {
      icon: '👋',
      title: 'Welcome to the Command Deck',
      body: 'Your whole operation on one screen: live KPIs, every application across all clients, and the tools to run the pipeline.',
    },
    {
      icon: '🧭',
      title: 'The sidebar is your control panel',
      body: 'Dashboard is the main deck. Profiles, Resumes, Issues, and Settings sit directly under it — everything is one click away.',
    },
    {
      icon: '📊',
      title: 'KPIs are real numbers',
      body: 'Total applied, saved, tailored, skipped, queue fill and apply-rate — all computed live from the database, not estimates.',
    },
    {
      icon: '🔄',
      title: 'Refill keeps queues full',
      body: 'Refill Jobs scrapes 7 boards in parallel (concurrent, fast). New jobs are auto-tailored on arrival so workers can start instantly.',
    },
    {
      icon: '🛟',
      title: 'Issues tab = worker reports',
      body: 'When workers report problems they land in Issues with full status tracking. You also get email digests of pending approvals.',
    },
    {
      icon: '🚀',
      title: "You're ready",
      body: 'Open Refill Jobs to top up supply, or dive into Applications to inspect any job.',
    },
  ],
};

export default function OnboardingTour({ role }: { role: Role }) {
  const slides = SLIDES[role];
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);

  // Auto-open once per role on first login.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || '[]';
      let seen: string[] = [];
      try { seen = JSON.parse(raw); } catch { /* ignore */ }
      if (!seen.includes(role)) {
        seen.push(role);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
        const t = setTimeout(() => setOpen(true), 600);
        return () => clearTimeout(t);
      }
    } catch { /* storage unavailable */ }
  }, [role]);

  // Re-open via the "How it works" button.
  useEffect(() => {
    const handler = () => { setIdx(0); setOpen(true); };
    window.addEventListener(OPEN_EVENT, handler);
    return () => window.removeEventListener(OPEN_EVENT, handler);
  }, []);

  const finish = useCallback(() => {
    setOpen(false);
    try { localStorage.setItem(DONE_KEY, '1'); } catch { /* ignore */ }
    window.dispatchEvent(new Event('jobbidder:onboarding-done'));
  }, []);

  // Escape to close; arrow keys to navigate.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight' && idx < slides.length - 1) setIdx((i) => i + 1);
      if (e.key === 'ArrowLeft' && idx > 0) setIdx((i) => i - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, idx, slides.length, finish]);

  if (!open) return null;
  const s = slides[idx];
  const last = idx === slides.length - 1;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="How it works"
      onClick={finish}
    >
      <div
        className="w-full max-w-lg bg-navy-900 border border-navy-700 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1.5 pt-5">
          {slides.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-6 bg-[var(--accent)]' : 'w-1.5 bg-navy-700'}`}
            />
          ))}
        </div>

        <div className="px-6 sm:px-8 pb-6 pt-4 text-center">
          <div className="text-5xl mb-4 select-none">{s.icon}</div>
          <h2 className="text-lg sm:text-xl font-semibold text-navy-50 text-pretty">{s.title}</h2>
          <p className="text-sm text-navy-300 mt-2 leading-relaxed">{s.body}</p>
          {s.points && (
            <ul className="mt-4 space-y-2 text-left max-w-sm mx-auto">
              {s.points.map((p) => (
                <li key={p} className="flex items-start gap-2 text-sm text-navy-300">
                  <span className="mt-0.5 text-[var(--accent)]">✓</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-6 sm:px-8 pb-6 flex items-center justify-between gap-3">
          <button
            onClick={finish}
            className="text-sm text-navy-500 hover:text-navy-300 transition-colors"
          >
            Skip
          </button>
          <div className="flex items-center gap-2">
            {idx > 0 && (
              <button
                onClick={() => setIdx((i) => i - 1)}
                className="px-4 py-2.5 text-sm rounded-lg bg-navy-800 text-navy-200 hover:bg-navy-750 min-h-[44px]"
              >
                Back
              </button>
            )}
            <button
              onClick={() => (last ? finish() : setIdx((i) => i + 1))}
              className="px-5 py-2.5 text-sm font-medium rounded-lg text-white min-h-[44px] transition-[filter] hover:brightness-110"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))' }}
            >
              {last ? 'Get started' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
