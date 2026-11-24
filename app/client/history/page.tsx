import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import ClientHistoryClient from './ClientHistoryClient';

export default async function ClientHistoryPage() {
  const user = await requireRole('client').catch(() => null);
  if (!user || !user.profile_id) redirect('/login');

  // History should show every application that was actually submitted —
  // including ones that progressed. Filtering only 'applied' meant a job that
  // moved to confirmed/interview would vanish from the client's history, which
  // reads as if it had been deleted.
  const jobs = await db.listJobsSlim({
    profile_id: user.profile_id,
    status: ['applied', 'confirmed', 'interview'],
  });
  return <ClientHistoryClient user={user} jobs={jobs} />;
}