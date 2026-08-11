'use client';

import { useEffect, useState } from 'react';
import { Spinner } from '@/components/Icon';

// Admin controls for the maintenance / announcement banner shown on all pages.
export default function MaintenancePanel() {
  const [message, setMessage] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/config/maintenance')
      .then((r) => r.json().catch(() => null))
      .then((d) => {
        if (d) {
          setMessage(d.message ?? '');
          setEnabled(d.enabled ?? false);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch('/api/config/maintenance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, enabled }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || 'Save failed');
      }
      setStatus(enabled ? 'Banner is live on all pages.' : 'Saved — banner is off.');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel overflow-hidden">
      <div className="p-3 border-b border-navy-700 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-navy-200">Maintenance / Announcement</h3>
        <span
          className={`text-xs px-2 py-0.5 rounded ${
            enabled ? 'bg-amber-500/20 text-amber-200' : 'bg-navy-800 text-navy-400'
          }`}
        >
          {enabled ? 'Live' : 'Off'}
        </span>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <label className="text-xs text-navy-400 mb-1 block">Message (downtime, issues, news)</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={2000}
            placeholder="e.g. We're performing scheduled maintenance tonight 10pm–11pm. Applications may be briefly unavailable."
            className="w-full h-24 bg-navy-950 border border-navy-700 rounded-md p-3 text-sm text-navy-100 placeholder:text-navy-500 focus:outline-none focus:border-brand-blue resize-y"
          />
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-navy-200 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-brand-green"
            />
            Show this notice to workers &amp; clients
          </label>
          <button
            onClick={save}
            disabled={saving}
            className="ml-auto inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-emerald-600/20 text-brand-green hover:bg-emerald-600/30 disabled:opacity-50"
          >
            {saving ? <Spinner /> : null} Save
          </button>
        </div>
        {status && <p className="text-sm text-navy-300">{status}</p>}
      </div>
    </section>
  );
}