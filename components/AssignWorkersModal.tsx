'use client';

import { useCallback, useEffect, useState } from 'react';
import Modal from './Modal';
import { Spinner } from './Icon';
import type { Profile, User } from '@/lib/types';

// Admin "Assign Workers" — lets you choose which client profile(s) each worker
// handles (Option B join). Swap = assign a client to a different worker here.
export default function AssignWorkersModal({
  open,
  onClose,
  profiles,
  workers,
}: {
  open: boolean;
  onClose: () => void;
  profiles: Profile[];
  workers: User[];
}) {
  const [selWorker, setSelWorker] = useState('');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const loadWorker = useCallback(async (workerId: string) => {
    setError(null);
    try {
      const res = await fetch('/api/assignments');
      if (!res.ok) throw new Error('Failed to load assignments');
      const data: Record<string, string[]> = await res.json();
      const ids = new Set(data[workerId] ?? []);
      const next: Record<string, boolean> = {};
      for (const p of profiles) next[p.id] = ids.has(p.id);
      setChecked(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    }
  }, [profiles]);

  // Reset state when modal opens / worker changes.
  useEffect(() => {
    if (open && selWorker) {
      setSaving(false); setSaved(false);
      loadWorker(selWorker);
    }
  }, [open, selWorker, loadWorker]);

  async function save() {
    if (!selWorker || saving) return;
    setSaving(true); setError(null); setSaved(false);
    const profile_ids = Object.keys(checked).filter((id) => checked[id]);
    try {
      const res = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_user_id: selWorker, profile_ids }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} wide title="Assign Workers to Clients">
      <div className="space-y-4">
        <p className="text-xs text-navy-400">
          Pick a worker, then tick every client you want them to handle. Unticking a
          client removes them (swap = tick it under another worker). Changes apply on Save.
        </p>

        <div>
          <label className="text-xs text-navy-400 block mb-1">Worker</label>
          <select
            value={selWorker}
            onChange={(e) => setSelWorker(e.target.value)}
            className="w-full bg-navy-950 border border-navy-700 rounded-md px-2.5 py-2 text-sm text-navy-100"
          >
            <option value="">Select a worker…</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>{w.full_name || w.email}</option>
            ))}
          </select>
        </div>

        {selWorker && (
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {profiles.length === 0 && <p className="text-navy-500 text-sm">No clients yet.</p>}
            {profiles.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-2.5 px-3 py-2 rounded-md border border-navy-800 hover:bg-navy-900/60 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={!!checked[p.id]}
                  onChange={(e) => setChecked((c) => ({ ...c, [p.id]: e.target.checked }))}
                  className="accent-brand-green"
                />
                <span className="text-sm text-navy-200">{p.name}</span>
                <span className="ml-auto text-xs text-navy-500 truncate">{p.email}</span>
              </label>
            ))}
          </div>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        {saved && <p className="text-xs text-brand-green">Saved assignment.</p>}

        <div className="flex justify-end gap-2 pt-2 border-t border-navy-800">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md text-navy-300 hover:text-white hover:bg-navy-800"
          >
            Close
          </button>
          <button
            onClick={save}
            disabled={!selWorker || saving}
            className="inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md bg-brand-green text-navy-950 hover:bg-brand-greenDark disabled:opacity-40"
          >
            {saving ? <><Spinner /> Saving…</> : 'Save assignments'}
          </button>
        </div>
      </div>
    </Modal>
  );
}