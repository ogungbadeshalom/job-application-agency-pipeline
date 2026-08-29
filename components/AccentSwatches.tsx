'use client';

import { useEffect, useState } from 'react';
import {
  ACCENTS,
  STORAGE_KEY,
  applyAccent,
  normalizeAccent,
} from '@/lib/accent';

/** Read a pre-paint localStorage accent, if one exists and is valid. */
function localPrefetchSafe(): string {
  if (typeof window === 'undefined') return '';
  try {
    return normalizeAccent(localStorage.getItem(STORAGE_KEY));
  } catch {
    return '';
  }
}

/**
 * Compact per-user accent picker for the shared nav shell.
 *
 * Each account's accent is stored SERVER-SIDE (users.accent) so a worker's
 * choice follows them across every browser/device they sign in on. The flow:
 *   1. `initialAccent` (server-rendered via the hydrated user) is applied
 *      immediately on mount — authoritative, no flash of a stale local value.
 *   2. Fall back to any pre-paint localStorage accent when not server-provided.
 *   3. On mount, fetch /api/me/accent and reconcile the server value.
 *   4. On click, apply + save to the server + mirror to localStorage.
 */
export default function AccentSwatches({
  compact = false,
  initialAccent = '',
}: {
  compact?: boolean;
  initialAccent?: string;
}) {
  const [accent, setAccent] = useState<string>(() =>
    normalizeAccent(initialAccent !== '' ? initialAccent : localPrefetchSafe())
  );

  // Apply the resolved accent to the DOM as soon as we have it.
  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  // Synchronize with the signed-in account's server-side preference.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/me/accent', { cache: 'no-store' })
      .then((r) => r.json().catch(() => null))
      .then((d) => {
        if (cancelled || !d || typeof d.accent !== 'string') return;
        const value = normalizeAccent(d.accent);
        if (value !== accent || !initialAccent) {
          setAccent(value);
          try {
            localStorage.setItem(STORAGE_KEY, value);
          } catch {}
        }
      })
      .catch(() => {}); // not authed or offline -> keep current choice
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choose(value: string) {
    const v = normalizeAccent(value);
    setAccent(v);
    applyAccent(v);
    try {
      localStorage.setItem(STORAGE_KEY, v);
    } catch {}
    // Persist per-user for the signed-in account. Fire-and-forget; the
    // local/DOM update is applied immediately regardless of network result.
    fetch('/api/me/accent', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accent: v }),
    }).catch(() => {});
  }

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Accent color">
      {ACCENTS.map((a) => {
        const active = accent === a.value;
        const sz = compact ? 'h-4 w-4' : 'h-5 w-5';
        return (
          <button
            key={a.value}
            type="button"
            title={a.label}
            aria-label={a.label}
            aria-pressed={active}
            onClick={() => choose(a.value)}
            className={`${sz} rounded-full border transition-all ${
              active
                ? 'border-white scale-110'
                : 'border-navy-600 hover:border-navy-300'
            }`}
            style={{
              background: a.color,
              boxShadow: active ? `0 0 0 2px ${a.color}55` : undefined,
            }}
          />
        );
      })}
    </div>
  );
}