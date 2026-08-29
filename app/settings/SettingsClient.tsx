'use client';

import AccentSetting from '@/components/AccentSetting';
import DashboardLayout from '@/components/DashboardLayout';
import type { Role } from '@/lib/types';

export default function SettingsClient({
  user,
}: {
  user: { full_name: string; email: string; role: Role; accent: string };
}) {
  return (
    <DashboardLayout user={user} nav={navFor(user.role)} active="/settings">
      <div className="max-w-2xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-pretty text-navy-100">Settings</h1>
          <p className="text-sm text-navy-400 mt-1">
            Customize your view. Your choices are saved to your account and follow
            you on any device.
          </p>
        </div>

        <AccentSetting />

        {/* Admin full settings live in the Dashboard; point them there. */}
        {user.role === 'admin' && (
          <section className="panel p-4">
            <h3 className="text-sm font-semibold text-navy-200">Admin controls</h3>
            <p className="text-sm text-navy-400 mt-1">
              AI configuration, earnings pool, backups, team, and maintenance live
              in the dashboard's{' '}
              <a
                href="/admin/dashboard#settings"
                className="text-brand-blue hover:underline"
              >
                Settings tab
              </a>
              .
            </p>
          </section>
        )}
      </div>
    </DashboardLayout>
  );
}

function navFor(role: Role): { href: string; label: string }[] {
  switch (role) {
    case 'admin':
      return [{ href: '/admin/dashboard', label: 'Dashboard' }];
    case 'worker':
      return [{ href: '/worker/queue', label: 'Queue' }];
    case 'client':
    default:
      return [{ href: '/client/jobs', label: 'My Applications' }];
  }
}