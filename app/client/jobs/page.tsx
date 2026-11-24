import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import ClientJobsClient from './ClientJobsClient';
import type { Profile } from '@/lib/types';

export default async function ClientJobsPage() {
  const user = await requireRole('client').catch(() => null);
  if (!user || !user.profile_id) redirect('/login');

  const [jobs, profile, resumeWeeks] = await Promise.all([
    // 'tailored' = a resume exists but was never submitted. Keep it in the list
    // so the client can see work in progress, but it must NOT count as an
    // application. Simpler statuses the pipeline can advance a job INTO
    // (confirmed/interview) have to be included here or a successful
    // application would vanish from the client's view once it progressed.
    db.listJobs({
      profile_id: user.profile_id,
      status: ['applied', 'tailored', 'confirmed', 'interview'],
      liveTailoring: true,
    }),
    db.getProfile(user.profile_id),
    db.listResumeWeeks(user.profile_id),
  ]);
  const profiles: Profile[] = profile ? [profile] : [];

  return <ClientJobsClient user={user} jobs={jobs} profiles={profiles} resumeWeeks={resumeWeeks} />;
}