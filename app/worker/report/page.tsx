import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import ReportClient from './ReportClient';

export default async function WorkerReportPage() {
  const user = await requireRole('worker').catch(() => null);
  if (!user) redirect('/login');

  const profiles = await db.listProfilesByWorker(user.id);
  const nav = [
    { href: '/worker/queue', label: 'Queue' },
    { href: '/worker/history', label: 'History' },
    { href: '/worker/report', label: 'Report a problem' },
  ];

  return (
    <ReportClient
      user={user}
      nav={nav}
      profiles={profiles.map((p) => ({ id: p.id, name: p.name }))}
    />
  );
}