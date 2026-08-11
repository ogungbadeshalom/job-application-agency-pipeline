import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import ClientHistoryClient from './ClientHistoryClient';

export default async function ClientHistoryPage() {
  const user = await requireRole('client').catch(() => null);
  if (!user || !user.profile_id) redirect('/login');

  const jobs = await db.listJobs({ profile_id: user.profile_id, status: 'applied' });
  return <ClientHistoryClient user={user} jobs={jobs} />;
}