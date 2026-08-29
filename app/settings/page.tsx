import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import SettingsClient from './SettingsClient';

export default async function SettingsPage() {
  const user = await requireRole('admin', 'worker', 'client').catch(() => null);
  if (!user) redirect('/login');
  return <SettingsClient user={user} />;
}