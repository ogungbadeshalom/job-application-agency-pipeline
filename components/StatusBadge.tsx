import type { JobStatus } from '@/lib/types';

const STYLES: Record<JobStatus, { bg: string; text: string; label: string }> = {
  saved: { bg: 'bg-navy-700', text: 'text-navy-300', label: 'Saved' },
  tailored: { bg: 'bg-blue-500/15', text: 'text-brand-blue', label: 'Tailored' },
  applied: { bg: 'bg-emerald-500/15', text: 'text-brand-green', label: 'Applied' },
  rejected: { bg: 'bg-red-500/15', text: 'text-brand-red', label: 'Rejected' },
  interview: { bg: 'bg-purple-500/15', text: 'text-brand-purple', label: 'Interview' },
  offer: { bg: 'bg-yellow-500/15', text: 'text-brand-yellow', label: 'Offer' },
  withdrawn: { bg: 'bg-navy-700', text: 'text-navy-400', label: 'Withdrawn' },
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

export const STATUS_OPTIONS: JobStatus[] = [
  'saved',
  'tailored',
  'applied',
  'rejected',
  'interview',
  'offer',
  'withdrawn',
];
