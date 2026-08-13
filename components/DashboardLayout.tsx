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
  user: { full_name: string; email: string; role: Role };
  nav: NavItem[];
  active: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  // Collapsible desktop sidebar. Persisted across sessions so each user keeps
  // their preferred width. Starts expanded unless the user previously collapsed it.
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem('jb.sidebar.collapsed') === '1';
    } catch {
      return false;
    }
  });
  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem('jb.sidebar.collapsed', next ? '1' : '0');
      } catch {}
      return next;
    });
  }

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

  const NavLinks = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className={`flex-1 space-y-1 overflow-y-auto ${collapsed ? 'flex flex-col items-center' : ''}`} aria-label="Primary">
      {nav.map((n) => {
        const isActive = active === n.href;
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            title={collapsed ? n.label : undefined}
            aria-current={isActive ? 'page' : undefined}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium transition-colors border-l-2 ${
              isActive
                ? 'bg-brand-green/10 text-white border-brand-green'
                : 'border-transparent text-navy-300 hover:text-white hover:bg-brand-green/5'
            } ${collapsed ? 'justify-center w-10' : 'w-full'}`}
          >
            <span className={`flex-1 truncate ${collapsed ? 'hidden' : ''}`}>{n.label}</span>
            {typeof n.badge === 'number' && n.badge > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-navy-900/70 text-brand-green">
                {n.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const Logo = ({ onNavigate }: { onNavigate?: () => void }) => (
    <Link href={active} onClick={onNavigate} className="flex items-center gap-2 px-2 min-w-0">
      <span className="text-brand-green text-lg">●</span>
      <span className="font-semibold tracking-tight truncate">Job Bidder</span>
      <span className="text-xs px-1.5 py-0.5 rounded bg-brand-blue/15 text-brand-blue font-mono">
        v{APP_VERSION}
      </span>
    </Link>
  );

  return (
    <div className="min-h-screen flex flex-col">
      {/* Full-width maintenance banner ABOVE everything — in normal flow, so it
          simply pushes the sidebar/header/content down (no overlap, no shift). */}
      <MaintenanceBanner />

      <div className="flex-1 lg:flex">
        {/* Desktop sidebar (fixed left) */}
        <aside className={`hidden lg:flex flex-col fixed left-0 bottom-0 top-0 border-r border-navy-700 bg-navy-900 transition-[width] duration-200 ${collapsed ? 'w-16' : 'w-64'}`}>
        <div className={`px-3 py-4 border-b border-navy-700 flex items-center ${collapsed ? 'justify-center' : 'justify-between'} gap-2`}>
          {!collapsed && <Logo onNavigate={() => setMenuOpen(false)} />}
          {collapsed && (
            <span className="text-brand-green text-lg" title="Job Bidder">●</span>
          )}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`shrink-0 p-1.5 rounded-md text-navy-400 hover:text-navy-100 hover:bg-navy-800 ${collapsed ? '' : ''}`}
          >
            {collapsed ? <span className="text-base leading-none">»</span> : <span className="text-base leading-none">«</span>}
          </button>
          {!collapsed && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-navy-800 text-navy-400 uppercase">
              {roleLabel[user.role]}
            </span>
          )}
        </div>
        {actions && !collapsed && (
          <div className="p-3 border-b border-navy-700">{actions}</div>
        )}
        {actions && collapsed && (
          <div className="py-2 flex justify-center border-b border-navy-700">{actions}</div>
        )}
        <div className={`p-3 flex-1 flex flex-col ${collapsed ? 'items-center px-1' : ''}`}>
          <NavLinks />
        </div>
        <div className="p-3 border-t border-navy-800">
          {collapsed ? (
            <div className="flex justify-center pb-2">
              <span className="w-8 h-8 rounded-full bg-navy-800 flex items-center justify-center text-navy-200 text-xs font-semibold" title={user.full_name}>
                {user.full_name?.charAt(0) || '?'}
              </span>
            </div>
          ) : (
            <div className="px-2 pb-2 text-right">
              <div className="text-sm text-navy-200 truncate">{user.full_name}</div>
              <div className="text-xs text-navy-500 truncate">{user.email}</div>
            </div>
          )}
          <button
            onClick={logout}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-navy-300 hover:text-white hover:bg-navy-800 ${collapsed ? 'justify-center w-10 mx-auto' : ''}`}
          >
            <Logout /> {!collapsed && <span>Sign out</span>}
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
      <main className={`flex-1 min-w-0 ${collapsed ? 'lg:ml-16' : 'lg:ml-64'} max-w-[1400px] w-full px-4 sm:px-6 py-4 sm:py-6`}>
        {children}
      </main>
      </div>
    </div>
  );
}