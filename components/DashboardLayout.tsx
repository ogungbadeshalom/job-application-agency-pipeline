'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useState } from 'react';
import { Logout, Menu, Close } from './Icon';
import type { Role } from '@/lib/types';
import { APP_VERSION } from '@/lib/version';

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
  const [menuOpen, setMenuOpen] = useState(false);

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
      <header className="sticky top-0 z-40 border-b border-navy-700 bg-navy-900/95 backdrop-blur supports-[backdrop-filter]:bg-navy-900/80">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 h-14 flex items-center justify-between gap-2">
          {/* Left: logo + mobile menu toggle */}
          <div className="flex items-center gap-2 min-w-0">
            <Link href={active} className="flex items-center gap-2 min-w-0" onClick={() => setMenuOpen(false)}>
              <span className="text-brand-green text-lg">●</span>
              <span className="font-semibold tracking-tight truncate">Job Bidder</span>
              <span className="hidden xs:inline text-xs px-1.5 py-0.5 rounded bg-brand-blue/15 text-brand-blue font-mono">
                v{APP_VERSION}
              </span>
              <span className="hidden sm:inline text-xs px-1.5 py-0.5 rounded bg-navy-800 text-navy-400 uppercase">
                {roleLabel[user.role]}
              </span>
            </Link>

            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-1">
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

          {/* Right: actions + user + mobile toggle / logout */}
          <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
            {actions && <div className="hidden sm:block">{actions}</div>}
            <div className="hidden md:block text-right">
              <div className="text-sm text-navy-200 max-w-[180px] truncate">{user.full_name}</div>
              <div className="text-xs text-navy-500 max-w-[180px] truncate">{user.email}</div>
            </div>
            <button
              onClick={logout}
              title="Sign out"
              className="p-2 rounded-md text-navy-400 hover:text-navy-100 hover:bg-navy-800 order-last"
            >
              <Logout />
            </button>
            {/* Mobile hamburger (only when there are nav items to collapse) */}
            {nav.length > 0 && (
              <button
                onClick={() => setMenuOpen((v) => !v)}
                title={menuOpen ? 'Close menu' : 'Menu'}
                className="md:hidden p-2 rounded-md text-navy-400 hover:text-navy-100 hover:bg-navy-800"
              >
                {menuOpen ? <Close /> : <Menu />}
              </button>
            )}
          </div>
        </div>

        {/* Mobile dropdown nav */}
        {menuOpen && (
          <nav className="md:hidden border-t border-navy-800 bg-navy-900/95 backdrop-blur">
            <div className="px-3 py-2 space-y-1">
              {nav.map((n) => {
                const isActive = active === n.href;
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={() => setMenuOpen(false)}
                    className={`block px-3 py-2.5 rounded-md text-sm flex items-center justify-between transition-colors ${
                      isActive
                        ? 'bg-navy-800 text-navy-100'
                        : 'text-navy-300 hover:text-navy-100 hover:bg-navy-850'
                    }`}
                  >
                    <span>{n.label}</span>
                    {typeof n.badge === 'number' && n.badge > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-green/20 text-brand-green">
                        {n.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </nav>
        )}
      </header>

      <main className="flex-1 mx-auto max-w-[1400px] w-full px-4 sm:px-6 py-4 sm:py-6">{children}</main>
    </div>
  );
}