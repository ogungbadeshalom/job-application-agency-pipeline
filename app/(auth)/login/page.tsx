'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/Icon';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await signIn('credentials', {
        redirect: false,
        email,
        password,
      });

      if (res?.error) {
        setError('Invalid email or password.');
        return;
      }

      router.push('/');
      router.refresh();
    } catch {
      // e.g. network/server unreachable: reset so the form stays usable
      // instead of being stuck with a disabled submit button + spinner.
      setError('Unable to sign in. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon.png"
            alt="Job Bidder"
            className="h-14 w-14 mx-auto mb-3 object-contain"
          />
          <h1 className="text-2xl font-semibold text-navy-100">Job Bidder</h1>
          <p className="text-sm text-navy-400 mt-1">Sign in with your credentials</p>
        </div>

        <form onSubmit={onSubmit} className="panel p-6 space-y-4">
          <div>
            <label htmlFor="login-email" className="block th-uppercase mb-1">Email</label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              disabled={loading}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue disabled:opacity-60"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="block th-uppercase mb-1">Password</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              disabled={loading}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue disabled:opacity-60"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="text-sm text-brand-red bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md bg-brand-greenDark text-white hover:bg-brand-green disabled:opacity-50"
          >
            <Spinner size={16} className={loading ? '' : 'opacity-0'} />
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}