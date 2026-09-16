'use client';

// Proof Capture extension connector — lets a worker generate/copy their API
// token and paste it into the JobBidder Proof Capture Chrome extension (one-time
// setup). The token authenticates the cross-origin /api/proof/* endpoints the
// extension uses to screenshot + attach proof + mark Applied in one click.
import { useEffect, useState } from 'react';

export default function ProofCaptureSetting() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/proof/token');
      const d = await r.json().catch(() => ({}));
      setToken(d.token ?? null);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function generate() {
    setLoading(true);
    try {
      const r = await fetch('/api/proof/token', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (d.token) setToken(d.token);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  return (
    <section className="panel p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-navy-200">Proof Capture extension</h3>
        <span className="text-[10px] uppercase tracking-wide text-navy-500">Chrome</span>
      </div>
      <p className="text-sm text-navy-400 mt-1">
        Connect the &quot;JobBidder Proof Capture&quot; Chrome extension so you can screenshot +
        attach proof + mark Applied in one click. Copy your token into the extension&apos;s setup once.
      </p>

      {loading ? (
        <div className="text-sm text-navy-400 mt-3">Loading…</div>
      ) : token ? (
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 rounded-md bg-navy-900 border border-navy-700 text-sm text-brand-green break-all">
              {token}
            </code>
            <button
              onClick={copy}
              className="px-3 py-2 text-sm font-medium rounded-md bg-brand-green text-navy-950 hover:bg-brand-greenDark"
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
            <button
              onClick={generate}
              title="Rotate to a new token (old one stops working)"
              className="px-3 py-2 text-sm rounded-md border border-navy-600 text-navy-300 hover:text-white hover:bg-navy-800"
            >
              Rotate
            </button>
          </div>
          <p className="text-xs text-navy-500 mt-2">
            Treat this like a password — anyone with it can attach proof to your jobs.
          </p>
        </div>
      ) : (
        <button
          onClick={generate}
          className="mt-3 px-4 py-2 text-sm font-medium rounded-md bg-brand-green text-navy-950 hover:bg-brand-greenDark"
        >
          Generate token
        </button>
      )}
    </section>
  );
}