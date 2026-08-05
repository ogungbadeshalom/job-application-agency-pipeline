'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Logout } from './Icon';
import type { Role } from '@/lib/types';

interface NavItem {
  href: string;
  label: string;
  badge?: number;
}

export default function DashboardLayout({
  user,
  nav,
  active,
  children,
  actions,
}: {
  user: { full_name: string; email: string; role: Role };
  nav: NavItem[];
  active: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const router = useRouter();

  async function logout() {
    await signOut({ redirect: false });
    router.push('/login');
    router.refresh();
  }

  const roleLabel: Record<Role, string> = {
    admin: 'Admin',
    worker: 'Worker',
    client: 'Client',
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="border-b border-navy-700 bg-navy-900">
        <div className="mx-auto max-w-[1400px] px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href={active} className="flex items-center gap-2">
              <span className="text-brand-green text-lg">●</span>
              <span className="font-semibold tracking-tight">Job Bidder</span>
              <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-navy-800 text-navy-400 uppercase">
                {roleLabel[user.role]}
              </span>
            </Link>
            <nav className="flex items-center gap-1">
              {nav.map((n) => {
                const isActive = active === n.href;
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`px-3 py-1.5 rounded-md text-sm flex items-center gap-2 transition-colors ${
                      isActive
                        ? 'bg-navy-800 text-navy-100'
                        : 'text-navy-400 hover:text-navy-200 hover:bg-navy-850'
                    }`}
                  >
                    {n.label}
                    {typeof n.badge === 'number' && n.badge > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-green/20 text-brand-green">
                        {n.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {actions}
            <div className="text-right hidden sm:block">
              <div className="text-sm text-navy-200">{user.full_name}</div>
              <div className="text-xs text-navy-500">{user.email}</div>
            </div>
            <button
              onClick={logout}
              title="Sign out"
              className="p-2 rounded-md text-navy-400 hover:text-navy-100 hover:bg-navy-800"
            >
              <Logout />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-[1400px] w-full px-6 py-6">{children}</main>
    </div>
  );
}
