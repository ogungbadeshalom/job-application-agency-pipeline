'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Job, JobStatus, Profile } from '@/lib/types';
import { CLIENT_VISIBLE_STATUSES, STATUS_ORDER } from '@/lib/types';
import StatusBadge, { STATUS_OPTIONS } from './StatusBadge';
import { External, Search } from './Icon';

export type JobTableMode = 'admin' | 'worker' | 'client';

// Pretty display labels for scraped-source (board) names.
const BOARD_LABELS: Record<string, string> = {
  indeed: 'Indeed',
  linkedin: 'LinkedIn',
  glassdoor: 'Glassdoor',
  zip_recruiter: 'ZipRecruiter',
};

interface Column {
  key: string;
  label: string;
}

const COLUMNS: Record<JobTableMode, Column[]> = {
  admin: [
    { key: 'num', label: '#' },
    { key: 'title', label: 'Job Title' },
    { key: 'client', label: 'Client' },
    { key: 'company', label: 'Company' },
    { key: 'board', label: 'Board' },
    { key: 'link', label: 'Link' },
    { key: 'comp', label: 'Compensation' },
    { key: 'status', label: 'Status' },
    { key: 'resume', label: 'Resume' },
    { key: 'jd', label: 'JD' },
    { key: 'proof', label: 'Proof' },
    { key: 'dates', label: 'Added' },
  ],
  worker: [
    { key: 'num', label: '#' },
    { key: 'title', label: 'Title' },
    { key: 'company', label: 'Company' },
    { key: 'board', label: 'Board' },
    { key: 'comp', label: 'Compensation' },
    { key: 'status', label: 'Status' },
    { key: 'actions', label: 'Actions' },
  ],
  client: [
    { key: 'num', label: '#' },
    { key: 'title', label: 'Title' },
    { key: 'company', label: 'Company' },
    { key: 'board', label: 'Board' },
    { key: 'status', label: 'Status' },
    { key: 'date', label: 'Date Applied' },
    { key: 'link', label: 'Link' },
  ],
};

function fmtMoney(min: number | null | undefined, max: number | null | undefined) {
  if (!min && !max) return '—';
  const f = (n: number) => `$${(n / 1000).toFixed(0)}k`;
  if (min && max) return `${f(min)}–${f(max)}`;
  return f((min || max)!);
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function JobTable({
  jobs,
  profiles,
  mode,
  onQuickAction,
  onRowClick,
}: {
  jobs: Job[];
  profiles: Profile[];
  mode: JobTableMode;
  onQuickAction?: (job: Job, action: 'applied' | 'skipped' | 'saved') => void;
  onRowClick?: (job: Job) => void;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>('all');
  const [clientFilter, setClientFilter] = useState<string>('all');

  const profileName = useMemo(() => {
    const map = new Map(profiles.map((p) => [p.id, p.name]));
    return (id: string) => map.get(id) ?? '—';
  }, [profiles]);

  const filtered = useMemo(() => {
    let out = jobs;
    if (mode === 'client') {
      out = out.filter((j) => CLIENT_VISIBLE_STATUSES.includes(j.status));
    }
    if (statusFilter !== 'all') out = out.filter((j) => j.status === statusFilter);
    if (mode === 'admin' && clientFilter !== 'all')
      out = out.filter((j) => j.profile_id === clientFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter(
        (j) =>
          j.title.toLowerCase().includes(q) ||
          j.company.toLowerCase().includes(q) ||
          (j.description || '').toLowerCase().includes(q)
      );
    }
    return [...out].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }, [jobs, search, statusFilter, clientFilter, mode]);

  const cols = COLUMNS[mode];

  return (
    <div className="panel overflow-hidden">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 p-3 border-b border-navy-700">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-navy-500"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search jobs…"
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-navy-950 border border-navy-700 rounded-md text-navy-100 placeholder:text-navy-500 focus:outline-none focus:border-brand-blue"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as JobStatus | 'all')}
          className="text-sm bg-navy-950 border border-navy-700 rounded-md px-2 py-1.5 text-navy-200 focus:outline-none focus:border-brand-blue"
        >
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {mode === 'admin' && (
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="text-sm bg-navy-950 border border-navy-700 rounded-md px-2 py-1.5 text-navy-200 focus:outline-none focus:border-brand-blue"
          >
            <option value="all">All clients</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <div className="ml-auto text-xs text-navy-500">{filtered.length} jobs</div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy-700">
              {cols.map((c) => (
                <th key={c.key} className="th-uppercase text-left px-3 py-2 whitespace-nowrap">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={cols.length}
                  className="px-3 py-10 text-center text-navy-500 text-sm"
                >
                  No jobs found.
                </td>
              </tr>
            )}
            {filtered.map((job, i) => {
              const jobHref = mode === 'worker' ? `/worker/job/${job.id}` : undefined;
              return (
                <tr key={job.id} className="border-b border-navy-800 row-hover">
                  <Cell>{i + 1}</Cell>
                  {mode === 'admin' && (
                    <Cell>
                      <span className="text-navy-100">{job.title || 'Untitled'}</span>
                    </Cell>
                  )}
                  {mode === 'admin' && <Cell>{profileName(job.profile_id)}</Cell>}
                  {(mode === 'worker' || mode === 'client') && (
                    <Cell>
                      {mode === 'client' && onRowClick ? (
                        <button
                          onClick={() => onRowClick(job)}
                          className="text-left text-brand-blue hover:underline"
                        >
                          {job.title || 'Untitled'}
                        </button>
                      ) : jobHref ? (
                        <Link href={jobHref} className="text-brand-blue hover:underline">
                          {job.title || 'Untitled'}
                        </Link>
                      ) : (
                        <span>{job.title || 'Untitled'}</span>
                      )}
                    </Cell>
                  )}
                  <Cell>{job.company}</Cell>
                  <Cell>
                    <span className="capitalize text-navy-300">{BOARD_LABELS[job.board] ?? job.board}</span>
                  </Cell>
                  {(mode === 'admin' || mode === 'client') && (
                    <Cell>
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-brand-blue hover:underline"
                      >
                        Open <External size={12} />
                      </a>
                    </Cell>
                  )}
                  <Cell>{fmtMoney(job.compensation_min, job.compensation_max)}</Cell>
                  <Cell>
                    <StatusBadge status={job.status} />
                  </Cell>

                  {mode === 'admin' && (
                    <>
                      <Cell>
                        {job.tailored_resume ? (
                          <span className="text-brand-green" title="Resume tailored">
                            ✓
                          </span>
                        ) : (
                          <span className="text-navy-600">—</span>
                        )}
                      </Cell>
                      <Cell>
                        {job.description ? (
                          <span className="text-navy-400" title="JD available">
                            ✓
                          </span>
                        ) : (
                          <span className="text-navy-600">—</span>
                        )}
                      </Cell>
                      <Cell>
                        {job.proof_of_submission ? (
                          <span className="text-navy-300" title={job.proof_of_submission}>
                            ✓
                          </span>
                        ) : (
                          <span className="text-navy-600">—</span>
                        )}
                      </Cell>
                      <Cell className="text-navy-500 text-xs whitespace-nowrap">
                        {fmtDate(job.created_at)}
                      </Cell>
                    </>
                  )}

                  {mode === 'worker' && (
                    <Cell>
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/worker/job/${job.id}`}
                          className="px-2.5 py-1 text-xs rounded-md bg-navy-800 text-navy-200 hover:bg-navy-750"
                        >
                          Tailor
                        </Link>
                        {STATUS_ORDER[job.status] < STATUS_ORDER.applied && (
                          <button
                            onClick={() => onQuickAction?.(job, 'applied')}
                            className="px-2.5 py-1 text-xs rounded-md bg-emerald-600/20 text-brand-green hover:bg-emerald-600/30"
                          >
                            Mark Applied
                          </button>
                        )}
                        {job.status === 'skipped' ? (
                          <button
                            onClick={() => onQuickAction?.(job, 'saved')}
                            className="px-2 py-1 text-xs rounded-md bg-emerald-600/20 text-brand-green hover:bg-emerald-600/30"
                          >
                            Unskip
                          </button>
                        ) : (
                          <button
                            onClick={() => onQuickAction?.(job, 'skipped')}
                            className="px-2 py-1 text-xs rounded-md text-navy-400 hover:bg-navy-800"
                          >
                            Skip
                          </button>
                        )}
                      </div>
                    </Cell>
                  )}

                  {mode === 'client' && (
                    <Cell className="text-navy-400 text-xs whitespace-nowrap">
                      {fmtDate(job.submitted_at)}
                    </Cell>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 align-middle ${className}`}>{children}</td>;
}
