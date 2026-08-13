'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  remoteok: 'RemoteOK',
  builtin: 'BuiltIn',
};

interface Column {
  key: string;
  label: string;
}

const COLUMNS: Record<JobTableMode, Column[]> = {
  admin: [
    { key: 'title', label: 'Job Title' },
    { key: 'client', label: 'Client' },
    { key: 'company', label: 'Company' },
    { key: 'board', label: 'Board' },
    { key: 'progress', label: 'Progress' },
    { key: 'status', label: 'Status' },
    { key: 'dates', label: 'Added' },
  ],
  worker: [
    { key: 'num', label: '#' },
    { key: 'title', label: 'Title' },
    { key: 'company', label: 'Company' },
    { key: 'board', label: 'Board' },
    { key: 'comp', label: 'Compensation' },
    { key: 'status', label: 'Status' },
    { key: 'date', label: 'Added' },
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
  if (Number.isNaN(d.getTime())) return '—';
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
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>('all');
  const [clientFilter, setClientFilter] = useState<string>('all');

  // Navigate to a job WITHOUT letting Next auto-scroll-to-top, so a Back later
  // returns to the same scroll position. Falls back to a plain Link.
  function openJob(href: string) {
    router.push(href, { scroll: false });
  }

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
      const boardLabel = (b: string) => (BOARD_LABELS[b] ?? b ?? '').toLowerCase();
      out = out.filter(
        (j) =>
          (j.title || '').toLowerCase().includes(q) ||
          (j.company || '').toLowerCase().includes(q) ||
          (j.description || '').toLowerCase().includes(q) ||
          boardLabel(j.board).includes(q) ||
          (j.location || '').toLowerCase().includes(q) ||
          (j.compensation_currency || '').toLowerCase().includes(q)
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
            placeholder="Search by title, company, board, or location…"
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

      {/* Mobile: compact card list (replaces the dense table on phones) */}
      <div className="md:hidden divide-y divide-navy-800">
        {filtered.length === 0 && (
          <div className="p-6 text-center text-navy-500 text-sm">No jobs found.</div>
        )}
        {filtered.map((job, i) => (
          <MobileJobCard key={job.id} job={job} index={i} mode={mode} profileName={profileName} onQuickAction={onQuickAction} />
        ))}
      </div>

      {/* Table (desktop+) */}
      <div className="hidden md:block overflow-x-auto">
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
                <tr key={job.id} id={`job-row-${job.id}`} className="border-b border-navy-800 row-hover">
                  {mode !== 'admin' && <Cell>{i + 1}</Cell>}
                  {mode === 'admin' && (
                    <Cell className="min-w-[260px] max-w-[380px]">
                      <span className="text-navy-100 flex items-center gap-1.5">
                        {job.url ? (
                          <a
                            href={job.url}
                            target="_blank"
                            rel="noreferrer"
                            title={job.title || 'Untitled'}
                            className="truncate font-medium text-navy-100 hover:text-brand-blue hover:underline"
                          >
                            {job.title || 'Untitled'}
                          </a>
                        ) : (
                          <span className="truncate font-medium" title={job.title || 'Untitled'}>
                            {job.title || 'Untitled'}
                          </span>
                        )}
                        {job.is_new && <NewBadge />}
                      </span>
                    </Cell>
                  )}
                  {mode === 'admin' && <Cell>{profileName(job.profile_id)}</Cell>}
                  {(mode === 'worker' || mode === 'client') && (
                    <Cell>
                      <span className="flex items-center gap-1.5">
                        {mode === 'client' && onRowClick ? (
                          <button
                            onClick={() => onRowClick(job)}
                            className="text-left font-medium text-navy-100 hover:text-brand-blue hover:underline"
                          >
                            {job.title || 'Untitled'}
                          </button>
                        ) : jobHref ? (
                          <a
                            href={jobHref}
                            onClick={(e) => {
                              e.preventDefault();
                              openJob(jobHref);
                            }}
                            className="font-medium text-navy-100 hover:text-brand-blue hover:underline"
                          >
                            {job.title || 'Untitled'}
                          </a>
                        ) : (
                          <span>{job.title || 'Untitled'}</span>
                        )}
                        {job.is_new && <NewBadge />}
                      </span>
                    </Cell>
                  )}
                  <Cell className="text-navy-400">{job.company || '—'}</Cell>
                  <Cell>
                    <span className="capitalize text-navy-300">
                      {BOARD_LABELS[job.board] ?? job.board ?? '—'}
                    </span>
                  </Cell>
                  {mode === 'client' && (
                    <Cell>
                      {job.url ? (
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-brand-blue hover:underline"
                        >
                          Open <External size={12} />
                        </a>
                      ) : (
                        <span className="text-navy-600">—</span>
                      )}
                    </Cell>
                  )}
                  {/* Admin: compact progress dots (resume / JD / proof) in place of
                      three separate check columns — reduces column sprawl. */}
                  {mode === 'admin' && (
                    <Cell>
                      <div className="flex items-center gap-1.5">
                        <Dot ok={!!job.tailored_resume} title="Resume tailored" />
                        <Dot ok={!!job.description} title="Job description" />
                        <Dot ok={!!job.proof_of_submission} title="Application proof" />
                      </div>
                    </Cell>
                  )}
                  {mode !== 'admin' && (
                    <Cell className="text-right font-mono text-sm text-navy-200 whitespace-nowrap">{fmtMoney(job.compensation_min, job.compensation_max)}</Cell>
                  )}
                  <Cell>
                    <StatusBadge status={job.status} />
                  </Cell>
                  {mode === 'worker' && (
                    <Cell className="text-navy-500 text-xs whitespace-nowrap">
                      <span title={job.created_at ? new Date(job.created_at).toLocaleString() : ''}>
                        {fmtDate(job.created_at)}
                      </span>
                    </Cell>
                  )}

                  {mode === 'admin' && (
                    <Cell className="text-navy-500 text-xs whitespace-nowrap">
                      {fmtDate(job.created_at)}
                    </Cell>
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
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}

// Compact progress dot for the admin "Progress" column (resume / JD / proof).
function Dot({ ok, title }: { ok: boolean; title: string }) {
  return (
    <span
      title={title}
      aria-label={title}
      className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-brand-green' : 'bg-navy-700'}`}
    />
  );
}

// Small green "NEW" pill next to freshly-scraped job titles (with a live accent
// dot on first appearance, per DESIGN.md).
function NewBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-brand-green/30 bg-brand-green/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-green">
      <span className="new-pulse h-1.5 w-1.5 rounded-full bg-brand-green" aria-hidden="true" />
      New
    </span>
  );
}

// Compact, tappable job card for phones — replaces the dense table columns on
// small screens. Mode-aware: shows the fields that matter for each role.
function MobileJobCard({
  job,
  index,
  mode,
  profileName,
  onQuickAction,
}: {
  job: Job;
  index: number;
  mode: JobTableMode;
  profileName: (id: string) => string;
  onQuickAction?: (job: Job, action: 'applied' | 'skipped' | 'saved') => void;
}) {
  const router = useRouter();
  // Soft client-side navigation (same as the desktop table) so tapping a job
  // on mobile doesn't trigger a full page reload. A reload defeats the queue's
  // scroll-preservation (sessionStorage restore) and re-fetches the whole app
  // shell — slow over the tunnel. scroll:false keeps the queue's scroll
  // position so a Back returns where the worker left off.
  function openJob(href: string) {
    router.push(href, { scroll: false });
  }
  const money = (() => {
    const { compensation_min, compensation_max } = job;
    if (!compensation_min && !compensation_max) return null;
    const f = (n: number) => `$${(n / 1000).toFixed(0)}k`;
    return compensation_min && compensation_max ? `${f(compensation_min)}–${f(compensation_max)}` : f((compensation_min || compensation_max)!);
  })();

  return (
    <div className="p-3.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {mode === 'worker' ? (
              <a
                href={`/worker/job/${job.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  openJob(`/worker/job/${job.id}`);
                }}
                className="font-medium text-navy-100 text-[15px] leading-snug truncate"
              >
                {job.title || 'Untitled'}
              </a>
            ) : (
              <span className="font-medium text-navy-100 text-[15px] leading-snug">{job.title || 'Untitled'}</span>
            )}
            {job.is_new && <NewBadge />}
          </div>
          <div className="text-sm text-navy-400 truncate">
            {job.company || '—'}
            {mode === 'admin' && job.profile_id && <span className="text-navy-500"> · #{index + 1}</span>}
          </div>
        </div>
        <StatusBadge status={job.status} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-navy-400">
        <span className="capitalize">{BOARD_LABELS[job.board] ?? job.board ?? '—'}</span>
        {money ? <span className="text-navy-200">{money}</span> : null}
        {job.location ? <span>{job.location}</span> : null}
        {mode === 'worker' && <span>Added {fmtDate(job.created_at)}</span>}
      </div>

      {mode === 'admin' && profileName(job.profile_id) !== '—' && (
        <div className="text-xs text-navy-300">{profileName(job.profile_id)}</div>
      )}

      {mode === 'worker' && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <a
            href={`/worker/job/${job.id}`}
            onClick={(e) => { e.preventDefault(); openJob(`/worker/job/${job.id}`); }}
            className="px-2.5 py-1 text-xs rounded-md bg-navy-800 text-navy-200 hover:bg-navy-750"
          >
            Tailor
          </a>
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
      )}
    </div>
  );
}
