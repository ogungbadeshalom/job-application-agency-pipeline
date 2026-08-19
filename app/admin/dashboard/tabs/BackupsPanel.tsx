'use client';

import { useEffect, useState } from 'react';

type BackupInfo = { name: string; size: number; mtime: string; url: string };

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

// Admin-only: list recent on-box backups and let the admin download each.
// Downloads stream from /api/backups/<name> (auth-guarded).
export default function BackupsPanel() {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backups')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setBackups(d?.backups ?? []))
      .catch(() => setBackups([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="panel overflow-hidden">
      <div className="p-3 border-b border-navy-700">
        <h3 className="text-sm font-semibold text-navy-200">Backups</h3>
        <p className="text-xs text-navy-500 mt-0.5">
          Automatic full backups run every 6 hours (13:00/03:00). Download any archive below.
        </p>
      </div>
      <div className="p-3">
        {loading ? (
          <p className="text-sm text-navy-500">Loading backups…</p>
        ) : backups.length === 0 ? (
          <p className="text-sm text-navy-500">No backups yet.</p>
        ) : (
          <ul className="divide-y divide-navy-800">
            {backups.map((b) => (
              <li key={b.name} className="py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm text-navy-100 truncate">{b.name}</div>
                  <div className="text-xs text-navy-500">
                    {fmtBytes(b.size)} · {new Date(b.mtime).toLocaleString()}
                  </div>
                </div>
                <a
                  href={b.url}
                  download
                  className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-md bg-brand-blue/20 text-brand-blue border border-brand-blue/30 hover:bg-brand-blue/30"
                >
                  Download
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}