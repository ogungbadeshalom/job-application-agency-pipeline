'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Joyride, EVENTS, Step, Placement, EventData } from 'react-joyride';
import type { Role } from '@/lib/types';

// Multi-page onboarding tour (react-joyride v3 + router navigation).
//
// react-joyride can only spotlight elements on the CURRENT page, so a tour
// that covers "every part of the software" must NAVIGATE: each role has an
// ordered list of sections; every section is { route, title, steps }. When a
// section's last step ends, the tour router.push()es to the next section, waits
// for that page's anchor element to mount, then resumes spotlighting. This walks
// the user through the whole app (queue -> history -> settings, or admin's tabs,
// or the client's jobs/resume-lab/history) instead of only the landing page.
//
// Auto-opens once per role on first login; re-openable via "How it works".
// Styled to the app's navy/green theme.

const STORAGE_KEY = 'jobbidder.onboarding.seen';
const DONE_KEY = 'jobbidder.onboarding.done';
const PENDING_KEY = 'jobbidder.onboarding.pending';
const OPEN_EVENT = 'jobbidder:open-onboarding';
const MOUNT_CHECK_MS = 100;
const MOUNT_TIMEOUT_MS = 8000;

interface RawStep {
  target: string; // CSS selector for a data-onboard anchor on THIS section's page
  title: string;
  body: string;
  placement?: Placement;
  // Highlighted element may be necessary even though it is not the first step
  // on its page — react-joyride needs the anchor to exist before the step runs.
}

interface Section {
  route: string; // path to navigate to for this section
  title: string; // breadcrumb shown in progress ("Part 2 of 3 — History")
  steps: RawStep[];
}

function toSteps(raw: RawStep[]): Step[] {
  return raw.map((s) => ({
    target: s.target,
    title: s.title,
    content: s.body,
    placement: s.placement ?? 'bottom',
  }));
}

// ---------------------------------------------------------------------------
// Sections per role — every reachable area of the app, in the order a user
// naturally explores it. Anchors must exist on the rendered page (see each
// target). Add new app areas here to extend the tour.
// ---------------------------------------------------------------------------

const WORKER_SECTIONS: Section[] = [
  {
    route: '/worker/queue',
    title: 'Your Queue',
    steps: [
      {
        target: '[data-onboard="queue-header"]',
        title: 'Welcome, teammate! 👋',
        body: 'This is your workspace. We’re highlighting every part of the software as you go so you can start applying with confidence.',
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
    ],
  },
  {
    route: '/worker/history',
    title: 'Completion History',
    steps: [
      {
        target: '[data-onboard="worker-history"]',
        title: 'Everything you’ve completed',
        body: 'Every job you Marked Applied lands here, grouped by week so you can see your output at a glance.',
      },
    ],
  },
];

const CLIENT_SECTIONS: Section[] = [
  {
    route: '/client/jobs',
    title: 'My Applications',
    steps: [
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
        title: 'Applied jobs',
        body: 'The table lists everything submitted on your behalf, with the resume and proof of submission for each one.',
        placement: 'top',
      },
    ],
  },
  {
    route: '/client/resume-lab',
    title: 'Resume Lab',
    steps: [
      {
        target: '[data-onboard="resume-lab"]',
        title: 'Resume Lab',
        body: 'Edit the resume content we work from, choose a design, and preview it live. Save once — it’s used on all your tailored resumes.',
        placement: 'left',
      },
    ],
  },
  {
    route: '/client/history',
    title: 'Application History',
    steps: [
      {
        target: '[data-onboard="client-history"]',
        title: 'Your history',
        body: 'Your full application timeline, grouped by week, so you can track everything at a glance.',
        placement: 'left',
      },
    ],
  },
];

const ADMIN_SECTIONS: Section[] = [
  {
    route: '/admin/dashboard',
    title: 'Command Deck',
    steps: [
      {
        target: '[data-onboard="admin-header"]',
        title: 'Welcome, boss 👋',
        body: 'This is your full command center. We’ll walk you through every part — from applications down to settings.',
      },
      {
        target: '[data-onboard="admin-tabs"]',
        title: 'Dashboard sections',
        body: 'The four tabs — Applications, Profiles, Resumes, Settings — are the whole operations console. Click each to switch views.',
      },
      {
        target: '[data-onboard="admin-table"]',
        title: 'Every application',
        body: 'The live table of all client jobs across every worker, with filters and export. Refill Jobs tops up supply when it runs low.',
        placement: 'top',
      },
    ],
  },
  {
    route: '/settings',
    title: 'Settings',
    steps: [
      {
        target: '[data-onboard="settings"]',
        title: 'Appearance & preferences',
        body: 'Set your accent color and preferences here. (AI config, earnings, backups, and team live in your Dashboard → Settings tab.)',
        placement: 'left',
      },
    ],
  },
];

const SECTIONS_BY_ROLE: Record<Role, Section[]> = {
  worker: WORKER_SECTIONS,
  client: CLIENT_SECTIONS,
  admin: ADMIN_SECTIONS,
};

export default function OnboardingTour({ role }: { role: Role }) {
  const router = useRouter();
  const pathname = usePathname();
  const sections = SECTIONS_BY_ROLE[role];

  const [running, setRunning] = useState(false);
  const [sectionIdx, setSectionIdx] = useState(0);
  const [steps, setSteps] = useState<Step[]>([]);
  // Navigator trigger: a counter bumped whenever we want the poll-effect to
  // (re)check whether we're on the pending section's route. Value is unused.
  const [navTick, setNavTick] = useState(0);
  // Live pathname. Kept in a ref so the poll interval always reads the CURRENT
  // route after navigation, even though the effect that started the interval
  // captured an older pathname (layout-level route changes don't reliably
  // re-fire that effect in production).
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  // Section we want once its route is mounted. Held in a ref so the polling
  // effect can start an interval WITHOUT re-triggering on its own state writes.
  const pendingRef = useRef<number | null>(null);

  const go = (idx: number) => {
    pendingRef.current = idx;
    // Persist across navigation remounts: each page mounts its own
    // DashboardLayout, so OnboardingTour unmounts on router.push and a fresh
    // instance mounts on the target page. Storing the pending section lets the
    // new instance resume where this one left off.
    try { localStorage.setItem(PENDING_KEY, String(idx)); } catch { /* ignore */ }
    if (pathnameRef.current !== sections[idx].route) {
      router.push(sections[idx].route);
    }
    setNavTick((v) => v + 1); // run the poll now (covers both already-on-page and post-navigation)
  };

  // ---- on EVERY mount, resume an in-flight tour if one was persisted across a
  //      page navigation (this component remounts per-page via DashboardLayout) ----
  useEffect(() => {
    let pending: number | null = null;
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (raw !== null) {
        const n = parseInt(raw, 10);
        if (!Number.isNaN(n) && n >= 0 && n < sections.length) pending = n;
      }
    } catch { /* ignore */ }
    if (pending !== null && pendingRef.current === null) {
      pendingRef.current = pending;
      setNavTick((v) => v + 1);
    }
    // Only on mount — do not clear PENDING here; the poll effect clears it
    // when the section is actually shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- advance from current section to the next ----
  const advance = () => {
    const next = sectionIdx + 1;
    if (next >= sections.length) {
      finish();
      return;
    }
    setRunning(false);
    setSectionIdx(next);
    go(next);
  };

  const finish = () => {
    setRunning(false);
    pendingRef.current = null;
    try {
      localStorage.removeItem(PENDING_KEY);
      localStorage.setItem(DONE_KEY, '1');
    } catch { /* ignore */ }
    window.dispatchEvent(new Event('jobbidder:onboarding-done'));
  };

  // ---- first-login auto-open (once per role) ----
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || '[]';
      let seen: string[] = [];
      try { seen = JSON.parse(raw); } catch { /* ignore */ }
      if (!seen.includes(role)) {
        seen.push(role);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
        setTimeout(() => go(0), 700);
      }
    } catch { /* storage unavailable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // ---- re-open via "How it works" ----
  useEffect(() => {
    const handler = () => go(0);
    window.addEventListener(OPEN_EVENT, handler);
    return () => window.removeEventListener(OPEN_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, pathname, sections]);

  // ---- run the pending section once its route has landed (after router.push)
  //      AND the first step's anchor is mounted. Waits for BOTH inside one
  //      interval so it does not depend on pathname being an effect dependency;
  //      it polls until route + anchor are ready. pendingRef is read only here,
  //      so starting the interval never re-runs this effect and kills it. ----
  useEffect(() => {
    const idx = pendingRef.current;
    if (idx === null) return;

    const firstTarget = sections[idx].steps[0].target;
    const deadline = Date.now() + MOUNT_TIMEOUT_MS;
    const iv = setInterval(() => {
      const landed = pathnameRef.current === sections[idx].route;
      const anchor = !!document.querySelector(firstTarget);
      if (landed && anchor) {
        clearInterval(iv);
        pendingRef.current = null;
        try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
        setSectionIdx(idx);
        setSteps(toSteps(sections[idx].steps));
        setRunning(true);
      } else if (Date.now() > deadline) {
        clearInterval(iv);
        pendingRef.current = null;
        // Route or anchor never became ready — bail out so the tour doesn't hang.
        setRunning(false);
      }
    }, MOUNT_CHECK_MS);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navTick, pathname, sections]);

  const onEvent = (data: EventData) => {
    if (data.type === EVENTS.TOUR_END) {
      // This section's last step completed.
      if (sectionIdx < sections.length - 1) advance();
      else finish();
    }
  };

  if (!running) return null;

  return (
    <div style={{ width: 0, height: 0 }}>
      <Joyride
        run
        steps={steps}
        onEvent={onEvent}
        continuous
        scrollToFirstStep
        locale={{
          next: 'Next',
          skip: 'Skip tour',
          close: 'Done',
          last: 'Done',
          back: 'Back',
        }}
        options={{
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
          tooltip: { borderRadius: 12, maxWidth: 340 },
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
    </div>
  );
}