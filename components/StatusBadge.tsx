import type { JobStatus } from '@/lib/types';

const STYLES: Record<JobStatus, { bg: string; text: string; label: string }> = {
  saved: { bg: 'bg-navy-700', text: 'text-navy-300', label: 'Saved' },
  tailored: { bg: 'bg-brand-blue/15', text: 'text-brand-blue', label: 'Tailored' },
  applied: { bg: 'bg-brand-green/15', text: 'text-brand-green', label: 'Applied' },
  skipped: { bg: 'bg-navy-700', text: 'text-navy-400', label: 'Skipped' },
  failed: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Failed' },
  confirmed: { bg: 'bg-brand-green/20', text: 'text-brand-green', label: 'Confirmed' },
  interview: { bg: 'bg-brand-blue/20', text: 'text-brand-blue', label: 'Interview' },
};

export default function StatusBadge({ status }: { status: JobStatus }) {
  const s = STYLES[status] ?? STYLES.saved;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}
    >
      {s.label}
    </span>
  );
}

export const STATUS_OPTIONS: JobStatus[] = ['saved', 'tailored', 'applied', 'skipped'];