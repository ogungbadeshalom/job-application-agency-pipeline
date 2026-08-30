'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { Logout, Menu, Close } from './Icon';
import type { Role } from '@/lib/types';
import { APP_VERSION } from '@/lib/version';

interface NavItem {
  href: string;
  label: string;
  badge?: number;
}

// Maintenance / announcement banner. Rendered in normal flow at the very top of
// the page (above the sidebar/top-bar), so everything naturally flows below it
// with NO overlap and NO layout-shift offsets — it just pushes content down.
function MaintenanceBanner() {
  const [msg, setMsg] = useState<{ enabled: boolean; message: string } | null>(null);
  useEffect(() => {
    fetch('/api/config/maintenance')
      .then((r) => r.json().catch(() => null))
      .then((d) => d && setMsg(d))
      .catch(() => {});
  }, []);
  if (!msg || !msg.enabled || !msg.message.trim()) return null;
  return (
    <div className="w-full bg-amber-500/15 border-b border-amber-500/40 text-amber-100 px-4 py-2.5 text-sm text-center">
      <span className="font-semibold mr-2">Notice:</span>
      {msg.message}
    </div>
  );
}

export default function DashboardLayout({
  user,
  nav,
  active,
  children,
  actions,
}: {
  user: { full_name: string; email: string; role: Role; accent: string };
  nav: NavItem[];
  active: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  // Fixed-width compact sidebar (no expand/collapse — keeps it out of the way).
  async function logout() {
    await signOut({ redirect: false });
    router.push('/login');
    router.refresh();
  }

  const NavLinks = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex-1 space-y-1 overflow-y-auto" aria-label="Primary">
      {nav.map((n) => {
        const isActive = active === n.href;
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            aria-current={isActive ? 'page' : undefined}
            className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded-md text-sm font-medium transition-colors border-l-2 w-full ${
                        isActive
                          ? 'bg-brand-green/10 text-white border-brand-green'
                          : 'border-transparent text-navy-300 hover:text-white hover:bg-brand-green/5'
                      }`}
                      >
                        <span className="w-full truncate leading-snug">{n.label}</span>
                        {typeof n.badge === 'number' && n.badge > 0 && (
                          <span className="text-[10px] px-1.5 py-px rounded-full bg-navy-900/70 text-brand-green leading-none">
                            {n.badge.toLocaleString()} applied
                          </span>
                        )}
                      </Link>
        );
      })}
      <div className="pt-2 mt-2 border-t border-navy-800">
        <Link
          href="/settings"
          onClick={onNavigate}
          aria-current={active === '/settings' ? 'page' : undefined}
          className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors border-l-2 w-full ${
            active === '/settings'
              ? 'bg-brand-green/10 text-white border-brand-green'
              : 'border-transparent text-navy-300 hover:text-white hover:bg-brand-green/5'
          }`}
        >
          <span className="w-full truncate leading-snug">Settings</span>
        </Link>
      </div>
    </nav>
  );

  const Logo = ({ onNavigate }: { onNavigate?: () => void }) => (
    <Link href={active} onClick={onNavigate} className="flex items-center gap-2 px-2 min-w-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icon.png"
        alt="Job Bidder"
        className="h-6 w-6 shrink-0 rounded-sm object-contain"
      />
      <span className="min-w-0 leading-tight">
        <span className="font-semibold tracking-tight block leading-snug">Job Bidder</span>
        <span className="block text-[10px] font-mono text-brand-blue/80">v{APP_VERSION}</span>
      </span>
    </Link>
  );

  return (
    <div className="min-h-screen flex flex-col">
      {/* Full-width maintenance banner ABOVE everything — in normal flow, so it
          simply pushes the sidebar/header/content down (no overlap, no shift). */}
      <MaintenanceBanner />

      <div className="flex-1 lg:flex">
        {/* Compact desktop sidebar (fixed left, no expander) */}
        <aside className="hidden lg:flex flex-col fixed left-0 bottom-0 top-0 border-r border-navy-700 bg-navy-900 w-36">
          <div className="px-2 py-3 border-b border-navy-700">
            <Logo onNavigate={() => setMenuOpen(false)} />
          </div>
          {actions && (
            <div className="px-2 py-2 border-b border-navy-700">{actions}</div>
          )}
          <div className="p-2 flex-1 flex flex-col overflow-y-auto">
            <NavLinks />
          </div>
          <div className="px-2 py-2 border-t border-navy-800">
            <div className="px-1 pb-1 truncate text-xs text-navy-300" title={user.full_name}>
              {user.full_name}
            </div>
            <button
              onClick={logout}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-navy-300 hover:text-white hover:bg-navy-800"
            >
              <Logout /> <span>Sign out</span>
            </button>
          </div>
        </aside>

      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-40 border-b border-navy-700 bg-navy-900/95 backdrop-blur">
        <div className="px-4 h-14 flex items-center justify-between gap-2">
          <Logo onNavigate={() => setMenuOpen(false)} />
          <div className="flex items-center gap-1.5">
            <button
              onClick={logout}
              title="Sign out"
              aria-label="Sign out"
              className="p-2 rounded-md text-navy-400 hover:text-navy-100 hover:bg-navy-800 order-last"
            >
              <Logout />
            </button>
            {nav.length > 0 && (
              <button
                onClick={() => setMenuOpen((v) => !v)}
                title={menuOpen ? 'Close menu' : 'Menu'}
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={menuOpen}
                className="p-2 rounded-md text-navy-400 hover:text-navy-100 hover:bg-navy-800"
              >
                {menuOpen ? <Close /> : <Menu />}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="w-64 bg-navy-900 border-r border-navy-700 flex flex-col">
            <div className="px-3 py-4 border-b border-navy-700 flex items-center justify-between">
              <Logo onNavigate={() => setMenuOpen(false)} />
              <button
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
                className="p-1.5 rounded-md text-navy-400 hover:text-navy-100"
              >
                <Close />
              </button>
            </div>
            {actions && (
              <div className="p-3 border-b border-navy-700">{actions}</div>
            )}
            <NavLinks onNavigate={() => setMenuOpen(false)} />
            <div className="p-3 border-t border-navy-800">
              <div className="px-2 py-2 text-sm text-navy-400 truncate">{user.full_name}</div>
              <button
                onClick={logout}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-navy-300 hover:text-white hover:bg-navy-800"
              >
                <Logout /> Sign out
              </button>
            </div>
          </div>
          <div className="flex-1 bg-black/50" onClick={() => setMenuOpen(false)} />
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 min-w-0 lg:ml-36 max-w-[1400px] w-full px-4 sm:px-6 py-4 sm:py-6">
        {children}
      </main>
      </div>
    </div>
  );
}