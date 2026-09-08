'use client';

import { useEffect, useState } from 'react';
import { Close, Check } from './Icon';
import type { Role } from '@/lib/types';

// Onboarding tour — a short, role-specific guided intro to Job Bidder.
//
// Auto-shows once per user (per role) on their first visit after login, and can
// be reopened anytime from the "?" / "How it works" button in the sidebar.
// Content is stored per (role) so a user who's used it before can review it.

interface Step {
  title: string;
  body: string;
  hint?: string;
}

// Worker tour: how they do the day-to-day.
const WORKER_STEPS: Step[] = [
  {
    title: 'Welcome, teammate! 👋',
    body: 'This is your Job Bidder workspace. Your job is simple: review the queue, tailor a resume for each role, and submit applications for the clients assigned to you.',
    hint: 'Each application you correctly submit earns you pay — the weekly pool meter at the top tracks it.',
  },
  {
    title: 'The Queue',
    body: 'The Queue lists every open role waiting for you. Columns show the company, title, board it was found on, compensation, and current status.',
    hint: 'Use the tabs to switch between jobs still to do (Working), already Applied, and Skipped.',
  },
  {
    title: 'Tailor the resume',
    body: 'Click a job, then open the "Tailor Resume" tab. The AI rewrites the client\'s resume to match that exact job description — contact details and job history stay accurate.',
    hint: 'Always tailor BEFORE applying. A tailored resume is what makes the application worth submitting.',
  },
  {
    title: 'Apply & mark it',
    body: 'Submit the application on the real job board, then click "Mark Applied". If the role isn\'t a fit, click "Skip" — skipping is normal and safe.',
    hint: 'The system prevents you from double-applying to the same posting. If it says a job is already applied, skip it instead.',
  },
  {
    title: 'Refill the queue',
    body: 'Run out of jobs? Use the Refill button to pull fresh remote roles for your client, or +Add Job to drop in a link you found yourself.',
    hint: 'New job duplicates are auto-blocked — you\'ll get a clear message if a posting is already in the queue.',
  },
  {
    title: 'Track earnings',
    body: 'The History page + the weekly pool meter show what you\'ve applied to this week and how much you\'ve earned toward your cap.',
  },
];

// Client tour: read-only view of their applications.
const CLIENT_STEPS: Step[] = [
  {
    title: 'Welcome, {name}! 👋',
    body: 'This is your personal Job Bidder view. Our team is submitting tailored applications on your behalf, and this is where you track every one of them.',
  },
  {
    title: 'My Applications',
    body: 'Every job we\'ve applied to for you appears here — company, title, and when it was submitted. Click any row to open the full tailored resume we used.',
    hint: 'This is read-only: you can see everything, but nothing here can be edited. Safe to browse freely.',
  },
  {
    title: 'Your tailored resumes',
    body: 'Open an application to read the exact resume we sent for that role, plus a link back to the original job posting.',
  },
  {
    title: 'History & Resume Lab',
    body: 'The History tab shows your application timeline. The Resume Lab lets you review and refine the resume profile our team works from — your changes apply to future applications.',
  },
  {
    title: 'Questions?',
    body: 'Your point of contact manages your account. Use the sidebar to jump around, or reach out if anything looks off.',
  },
];

const STORAGE_KEY = 'jobbidder.onboarding.seen'; // set of "role" values already seen

export default function OnboardingTour({ role }: { role: Role }) {
  const steps = role === 'client' ? CLIENT_STEPS : WORKER_STEPS;
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [name] = useState<string | null>(null);

  // Auto-open once per role the first time the user lands on a dashboard.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || '[]';
      let seen: string[] = [];
      try { seen = JSON.parse(raw); } catch { /* ignore */ }
      if (!seen.includes(role)) {
        setOpen(true);
        seen.push(role);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
      }
    } catch { /* storage unavailable — don't auto-open */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // Allow the nav "How it works" button (or any element) to reopen the tour by
  // dispatching a window event — the layout doesn't need to hold tour state.
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('jobbidder:open-onboarding', handler);
    return () => window.removeEventListener('jobbidder:open-onboarding', handler);
  }, []);

  // If a caller opens it again (e.g. the nav trigger), reset to step 0.
  useEffect(() => {
    if (open) setIdx(0);
  }, [open]);

  if (!open) return null;

  const step = steps[idx];
  const last = idx === steps.length - 1;
  const body = step.body.replace('{name}', name || 'friend');

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-2xl border border-navy-600 bg-navy-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-navy-700">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-brand-green" />
            <span className="text-sm font-semibold text-navy-100">How Job Bidder works</span>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close tour"
            className="p-1.5 rounded-md text-navy-400 hover:text-navy-100 hover:bg-navy-800"
          >
            <Close size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          <h3 className="text-lg font-semibold text-white mb-2">{step.title}</h3>
          <p className="text-sm leading-relaxed text-navy-200">{body}</p>
          {step.hint && (
            <p className="mt-3 text-xs leading-relaxed text-brand-green/80 border-l-2 border-brand-green/40 pl-3">
              {step.hint}
            </p>
          )}
        </div>

        {/* Progress + controls */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-navy-700">
          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-5 bg-brand-green' : 'w-1.5 bg-navy-600'}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-navy-500">{idx + 1}/{steps.length}</span>
            <button
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 rounded-md text-xs text-navy-300 hover:text-white hover:bg-navy-800"
            >
              Skip
            </button>
            <button
              onClick={() => (last ? setOpen(false) : setIdx((i) => i + 1))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-brand-green/20 text-brand-green border border-brand-green/30 hover:bg-brand-green/30"
            >
              {last ? (
                <>
                  Done <Check size={14} />
                </>
              ) : (
                'Next'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}