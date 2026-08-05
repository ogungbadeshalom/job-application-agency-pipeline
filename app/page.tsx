import { getSession, homeForRole } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function RootPage() {
  const session = await getSession();
  redirect(session ? homeForRole(session.user.role) : '/login');
}
