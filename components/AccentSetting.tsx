'use client';

import { useEffect, useState } from 'react';

/**
 * Accent color setting — switches the whole app between GREEN and RED accent
 * by setting a data-accent="red" attribute on <html> (globals.css keys off it).
 * Persists per-browser in localStorage. Rendered as a proper Settings row (not
 * a floating pill). Green is the default; reverting is one click.
 */
const KEY = 'jobbidder.accent';

export default function AccentSetting() {
  const [accent, setAccent] = useState<'green' | 'red'>('green');

  useEffect(() => {
    const saved = localStorage.getItem(KEY);
    const a = saved === 'red' ? 'red' : 'green';
    setAccent(a);
    if (a === 'red') document.documentElement.setAttribute('data-accent', 'red');
    else document.documentElement.removeAttribute('data-accent');
  }, []);

  function choose(a: 'green' | 'red') {
    setAccent(a);
    localStorage.setItem(KEY, a);
    if (a === 'red') document.documentElement.setAttribute('data-accent', 'red');
    else document.documentElement.removeAttribute('data-accent');
  }

  return (
    <section className="panel overflow-hidden">
      <div className="p-3 border-b border-navy-700">
        <h3 className="text-sm font-semibold text-navy-200">Appearance</h3>
      </div>
      <div className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-sm text-navy-100">Accent color</div>
          <div className="text-xs text-navy-500 mt-0.5">
            Applies across the whole app. Saved per-browser; green is the default.
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(['green', 'red'] as const).map((c) => (
            <button
              key={c}
              onClick={() => choose(c)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors ${
                accent === c
                  ? 'bg-navy-800 border-navy-500 text-navy-100'
                  : 'border-navy-700 text-navy-400 hover:bg-navy-800/60'
              }`}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: c === 'green' ? '#3fb950' : '#f85149' }}
              />
              <span className="capitalize">{c}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}