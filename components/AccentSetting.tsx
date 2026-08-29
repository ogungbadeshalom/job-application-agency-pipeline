'use client';

import { useEffect, useState } from 'react';
import {
  ACCENTS,
  STORAGE_KEY,
  applyAccent,
  normalizeAccent,
} from '@/lib/accent';

/**
 * Accent color setting — switches the whole app's accent between several
 * colors by setting data-accent="<color>" on <html> (globals.css keys off it).
 *
 * Saved SERVER-SIDE per-account (users.accent) so a choice follows the user
 * across devices, mirrored to localStorage for the pre-paint fast path.
 * Palette + validation live in lib/accent.ts.
 */
export default function AccentSetting() {
  const [accent, setAccent] = useState('');

  // Apply the current accent to the DOM.
  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  // Load the account's server accent, making it authoritative.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/me/accent', { cache: 'no-store' })
      .then((r) => r.json().catch(() => null))
      .then((d) => {
        if (cancelled || !d || typeof d.accent !== 'string') return;
        const value = normalizeAccent(d.accent);
        setAccent(value);
        try {
          localStorage.setItem(STORAGE_KEY, value);
        } catch {}
      })
      .catch(() => {}); // offline / not authed -> keep local default
    return () => {
      cancelled = true;
    };
  }, []);

  function choose(value: string) {
    const v = normalizeAccent(value);
    setAccent(v);
    applyAccent(v);
    try {
      localStorage.setItem(STORAGE_KEY, v);
    } catch {}
    // Persist per-user. Fire-and-forget; DOM applies instantly regardless.
    fetch('/api/me/accent', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accent: v }),
    }).catch(() => {});
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
            Applies across the whole app and follows your account on any device.
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {ACCENTS.map((a) => {
            const active = accent === a.value;
            return (
              <button
                key={a.value}
                title={a.label}
                aria-label={a.label}
                aria-pressed={active}
                onClick={() => choose(a.value)}
                className={`h-7 w-7 rounded-full border transition-all ${
                  active
                    ? 'border-navy-100 scale-110'
                    : 'border-navy-700 hover:border-navy-400'
                }`}
                style={{
                  background: a.color,
                  boxShadow: active ? `0 0 0 3px ${a.color}44` : undefined,
                }}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}