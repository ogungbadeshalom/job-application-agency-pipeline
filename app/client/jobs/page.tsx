import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import ClientJobsClient from './ClientJobsClient';
import type { Profile } from '@/lib/types';

export default async function ClientJobsPage() {
  const user = await requireRole('client').catch(() => null);
  if (!user || !user.profile_id) redirect('/login');

  // RLS-equivalent: client only sees their own APPLIED jobs.
  const [jobs, profile] = await Promise.all([
    db.listJobs({ profile_id: user.profile_id, status: 'applied' }),
    db.getProfile(user.profile_id),
  ]);
  const profiles: Profile[] = profile ? [profile] : [];

  return <ClientJobsClient user={user} jobs={jobs} profiles={profiles} />;
}
