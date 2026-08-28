'use client';

import { useEffect, useState } from 'react';

/**
 * Accent theme toggle — switches the whole app between the default GREEN
 * accent and a RED accent, purely by setting `data-accent="red"` on <html>.
 * The <html> attribute is what globals.css keys off. Choice persists in
 * localStorage (key: jobbidder.accent). Green is the default and reverting is
 * one click. Place it once in RootLayout so every role sees it.
 */
const KEY = 'jobbidder.accent';
type Accent = 'green' | 'red';

function applyAccent(a: Accent) {
  const el = document.documentElement;
  if (a === 'red') el.setAttribute('data-accent', 'red');
  else el.removeAttribute('data-accent');
}

export default function ThemeToggle() {
  const [accent, setAccent] = useState<Accent>('green');

  useEffect(() => {
    // apply whatever was saved (or default green) on mount
    const saved = (localStorage.getItem(KEY) as Accent) || 'green';
    setAccent(saved === 'red' ? 'red' : 'green');
    applyAccent(saved === 'red' ? 'red' : 'green');
  }, []);

  function toggle() {
    const next: Accent = accent === 'green' ? 'red' : 'green';
    setAccent(next);
    localStorage.setItem(KEY, next);
    applyAccent(next);
  }

  return (
    <button
      onClick={toggle}
      title="Switch accent color (green ↔ red). Your choice is saved and stored per-browser."
      className="fixed bottom-4 right-4 z-[60] inline-flex items-center gap-1.5 rounded-full border border-navy-600 bg-navy-900/90 px-3 py-2 text-xs font-semibold text-navy-100 shadow-[0_8px_28px_-8px_rgba(0,0,0,0.5)] hover:bg-navy-800"
      aria-label="Toggle accent color"
    >
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ background: accent === 'red' ? 'var(--accent)' : 'var(--accent)' }}
      />
      Accent: <span className="capitalize text-brand-green">{accent}</span>
    </button>
  );
}