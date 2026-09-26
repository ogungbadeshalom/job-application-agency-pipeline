'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Complaint } from '@/lib/types';

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/40',
  in_progress: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
  resolved: 'bg-green-500/15 text-green-300 border-green-500/40',
  wontfix: 'bg-navy-800 text-navy-400 border-navy-700',
};
const CATEGORY_LABELS: Record<string, string> = {
  bug: '🐞 Bug', slow: '🐢 Slow', login: '🔑 Login', resume: '📄 Resume',
  proof: '📸 Proof', 'job-quality': '🎯 Job quality', other: '… Other',
};

export default function ComplaintsTab() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/complaints${statusFilter ? `?status=${statusFilter}` : ''}`, { cache: 'no-store' });
    if (res.ok) setComplaints((await res.json()).complaints ?? []);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const update = async (id: string, patch: { status?: string; admin_note?: string }) => {
    await fetch(`/api/complaints/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    load();
  };

  return (
    <section className="panel overflow-hidden">
      <div className="p-3 border-b border-navy-700 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-navy-200">Worker Issues</h3>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-navy-950 border border-navy-700 rounded-md px-2 py-1 text-xs text-navy-100"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="resolved">Resolved</option>
          <option value="wontfix">Won&apos;t fix</option>
        </select>
      </div>

      {loading ? (
        <p className="p-4 text-sm text-navy-500">Loading…</p>
      ) : complaints.length === 0 ? (
        <p className="p-4 text-sm text-navy-500">No {statusFilter || ''} issues. When a worker reports a problem it shows up here.</p>
      ) : (
        <div className="divide-y divide-navy-800">
          {complaints.map((c) => (
            <div key={c.id} className="p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLE[c.status] ?? STATUS_STYLE.open}`}>
                      {c.status}
                    </span>
                    <span className="text-xs text-navy-400">{CATEGORY_LABELS[c.category] ?? c.category}</span>
                    {c.client_name && <span className="text-xs text-navy-500">· {c.client_name}</span>}
                  </div>
                  <div className="text-sm font-semibold text-navy-100 mt-1">{c.subject}</div>
                  {c.detail && <div className="text-sm text-navy-400 mt-0.5 whitespace-pre-wrap">{c.detail}</div>}
                  {c.url && (
                    <a href={c.url} target="_blank" rel="noreferrer" className="text-xs text-brand-blue hover:underline break-all">
                      {c.url}
                    </a>
                  )}
                </div>
                <div className="shrink-0 text-right text-xs text-navy-500">{c.worker_name ?? '—'}<br />{new Date(c.created_at).toLocaleString()}</div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={c.status}
                  onChange={(e) => update(c.id, { status: e.target.value })}
                  className="bg-navy-950 border border-navy-700 rounded-md px-2 py-1 text-xs text-navy-100"
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="wontfix">Won&apos;t fix</option>
                </select>
                <button
                  onClick={() => {
                    const note = prompt('Note for the worker / history:', c.admin_note ?? '');
                    if (note !== null) update(c.id, { admin_note: note });
                  }}
                  className="text-xs text-navy-400 hover:text-navy-200"
                >
                  {c.admin_note ? '✎ Edit note' : '+ Add note'}
                </button>
                {c.admin_note && <span className="text-xs text-navy-500 italic">“{c.admin_note}”</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}