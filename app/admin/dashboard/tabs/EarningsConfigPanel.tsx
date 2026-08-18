'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// Admin-only: configure the worker earnings pool meter.
//  - perAppNaira: private per-application rate (never shown to workers)
//  - weeklyCapNaira: the weekly naira cap the worker's pool meter fills toward
export default function EarningsConfigPanel() {
  const router = useRouter();
  const [perApp, setPerApp] = useState('');
  const [cap, setCap] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/earnings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setPerApp(String(d.perAppNaira ?? ''));
          setCap(String(d.weeklyCapNaira ?? ''));
        }
      })
      .catch(() => {
        /* auth/session — panel just stays blank */
      });
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/earnings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ perAppNaira: Number(perApp), weeklyCapNaira: Number(cap) }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || `Save failed (${res.status})`);
      }
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel overflow-hidden">
      <div className="p-3 border-b border-navy-700">
        <h3 className="text-sm font-semibold text-navy-200">Worker Earnings Pool</h3>
        <p className="text-xs text-navy-500 mt-0.5">
          The weekly naira meter workers see. The per-application rate is private.
        </p>
      </div>
      <div className="p-3 space-y-3">
        <label className="block">
          <span className="text-xs text-navy-400">Per-application rate (naira, private)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={perApp}
            onChange={(e) => setPerApp(e.target.value)}
            className="mt-1 w-full rounded-md bg-navy-800 border border-navy-700 px-3 py-2 text-navy-100"
            placeholder="e.g. 0.0105"
          />
        </label>
        <label className="block">
          <span className="text-xs text-navy-400">Weekly cap (naira, shown to worker)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            className="mt-1 w-full rounded-md bg-navy-800 border border-navy-700 px-3 py-2 text-navy-100"
            placeholder="e.g. 3500"
          />
        </label>
        {error && (
          <div className="text-sm text-brand-red bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        {saved && !error && (
          <div className="text-sm text-brand-green bg-green-500/10 border border-green-500/30 rounded-md px-3 py-2">
            Saved. Resets every Monday.
          </div>
        )}
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-md bg-brand-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  );
}