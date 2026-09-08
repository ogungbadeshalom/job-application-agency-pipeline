'use client';

import { useEffect, useState } from 'react';
import { Joyride, EVENTS, Step, Placement, EventData } from 'react-joyride';
import type { Role } from '@/lib/types';

// Proper onboarding tour using react-joyride v3. Each step targets a REAL UI
// element via a data-onboard anchor and spotlight-highlights it while
// explaining. Auto-opens once per role on first login; re-openable via the
// "How it works" trigger. Styled to the app's navy/green theme.

const STORAGE_KEY = 'jobbidder.onboarding.seen';
const OPEN_EVENT = 'jobbidder:open-onboarding';

interface RawStep {
  target: string;
  title: string;
  body: string;
  placement?: Placement;
}

function toSteps(raw: RawStep[]): Step[] {
  return raw.map((s) => ({
    target: s.target,
    title: s.title,
    content: s.body,
    placement: s.placement ?? 'bottom',
  }));
}

// Worker: spotlights real queue elements (anchored via data-onboard attrs).
const WORKER_RAW: RawStep[] = [
  {
    target: '[data-onboard="queue-header"]',
    title: 'Welcome, teammate! 👋',
    body: 'This is your workspace. We\'re highlighting each part so you can start applying with confidence.',
  },
  {
    target: '[data-onboard="queue-tabs"]',
    title: 'The Queue tabs',
    body: 'Working = jobs still to do. Applied = already submitted. Skipped = passed on. Use these to stay organized.',
  },
  {
    target: '[data-onboard="stats"]',
    title: 'Your weekly progress',
    body: 'Applied / quota / skipped for this week (Mon–Sun), plus your earnings pool. It resets every Monday.',
    placement: 'left',
  },
  {
    target: '[data-onboard="refill"]',
    title: 'Refill & Add Job',
    body: 'Run out of work? Refill pulls fresh remote roles. Add Job drops in a link you found. Duplicates are auto-blocked with a clear message.',
    placement: 'left',
  },
  {
    target: '[data-onboard="queue-table"]',
    title: 'Tailor, Apply, Skip',
    body: 'Open any job, then Tailor the resume — AI rewrites it to match that exact posting. Submit on the real site, then Mark Applied. Not a fit? Skip.',
    placement: 'top',
  },
];

// Client: spotlights the read-only application view.
const CLIENT_RAW: RawStep[] = [
  {
    target: '[data-onboard="client-header"]',
    title: 'Welcome! 👋',
    body: 'This is your personal Job Bidder view — read-only, so nothing here can be edited. Browsing is completely safe.',
  },
  {
    target: '[data-onboard="client-count"]',
    title: 'Your applications',
    body: 'Every job our team has tailored and submitted for you appears here. Click any row to open the exact resume we used and the original posting.',
    placement: 'left',
  },
  {
    target: '[data-onboard="client-table"]',
    title: 'History & Resume Lab',
    body: 'Resume Lab lets you review the profile we work from. History shows your application timeline. Ask us anything that looks off.',
    placement: 'top',
  },
];

const pick = (role: Role) => (role === 'client' ? CLIENT_RAW : WORKER_RAW);

export default function OnboardingTour({ role }: { role: Role }) {
  const [run, setRun] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);

  // First-login auto-open (once per role), after paint so anchors exist.
  useEffect(() => {
    try {
      const rawSeen = localStorage.getItem(STORAGE_KEY) || '[]';
      let seen: string[] = [];
      try { seen = JSON.parse(rawSeen); } catch { /* ignore */ }
      if (!seen.includes(role)) {
        seen.push(role);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
        setTimeout(() => {
          setSteps(toSteps(pick(role)));
          setRun(true);
        }, 700);
      }
    } catch { /* storage unavailable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // Re-open via the "How it works" trigger.
  useEffect(() => {
    const handler = () => {
      setSteps(toSteps(pick(role)));
      setRun(true);
    };
    window.addEventListener(OPEN_EVENT, handler);
    return () => window.removeEventListener(OPEN_EVENT, handler);
  }, [role]);

  const onEvent = (data: EventData) => {
    if (data.type === EVENTS.TOUR_END) setRun(false);
  };

  return (
    <Joyride
      run={run}
      steps={steps}
      onEvent={onEvent}
      continuous
      scrollToFirstStep
      options={{
        // Buttons shown in the tooltip footer: back, skip, primary (next/done).
        buttons: ['back', 'skip', 'primary'],
        primaryColor: '#22c55e',
        backgroundColor: '#0f172a',
        textColor: '#cbd5e1',
        overlayColor: 'rgba(2, 6, 23, 0.82)',
        arrowColor: '#0f172a',
        showProgress: true,
        zIndex: 10000,
      }}
      styles={{
        tooltip: { borderRadius: 12 },
        tooltipTitle: { color: '#f8fafc', fontSize: 15, fontWeight: 600 },
        tooltipContent: { color: '#cbd5e1', fontSize: 13.5, lineHeight: 1.5 },
        buttonSkip: { color: '#64748b', fontSize: 13 },
        buttonBack: { color: '#94a3b8', fontSize: 13 },
        buttonPrimary: {
          backgroundColor: '#22c55e',
          color: '#052e16',
          fontSize: 13,
          fontWeight: 600,
          borderRadius: 6,
        },
        buttonClose: { color: '#94a3b8' },
      }}
    />
  );
}