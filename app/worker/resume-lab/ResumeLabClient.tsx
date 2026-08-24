'use client';

import { useState, useMemo } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { RESUME_PRESETS, type ResumePreset } from '@/lib/resume-pdf';
import type { Role } from '@/lib/types';

interface NavItem { href: string; label: string; badge?: number }
interface Profile { id: string; name: string; resume_design?: string; base_resume_text?: string | null }

export default function ResumeLabClient({
  user,
  nav,
  clientProfiles,
}: {
  user: { full_name: string; email: string; role: Role };
  nav: NavItem[];
  clientProfiles: Profile[];
}) {
  const [clientId, setClientId] = useState<string>(clientProfiles[0]?.id ?? '');
  const [preset, setPreset] = useState<ResumePreset>(
    (clientProfiles[0]?.resume_design as ResumePreset) || 'classic'
  );
  const [previewNonce, setPreviewNonce] = useState(0);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const selected = clientProfiles.find((p) => p.id === clientId);

  function selectClient(id: string) {
    const p = clientProfiles.find((x) => x.id === id);
    setClientId(id);
    setPreset((p?.resume_design as ResumePreset) || 'classic');
    setPreviewNonce((n) => n + 1);
    setStatus(null);
  }

  async function choosePreset(next: ResumePreset) {
    setPreset(next);
    setPreviewNonce((n) => n + 1);
    if (!clientId) return;
    // Auto-save the per-client design choice.
    setSaving(true);
    try {
      const res = await fetch(`/api/profiles/${clientId}/design`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: next }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || 'Save failed');
      setStatus({ ok: true, text: `Saved ${next} design for ${selected?.name ?? 'this client'}.` });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  const previewUrl = useMemo(() => {
    const p = new URLSearchParams();
    p.set('profileId', clientId);
    p.set('preset', preset);
    return `/api/resume-preview?${p.toString()}&n=${previewNonce}`;
  }, [clientId, preset, previewNonce]);

  return (
    <DashboardLayout user={user} nav={nav} active="/worker/resume-lab">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-pretty text-navy-100">Resume Lab</h1>
        <p className="text-sm text-navy-400 mt-1">
          Preview how each client&apos;s resume looks, then pick a design style. Your choice is saved per client and used for every tailored resume.
        </p>
      </div>

      {/* Client picker */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-navy-500 uppercase tracking-wide">Client</span>
        {(clientProfiles || []).map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => selectClient(p.id)}
            className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
              clientId === p.id
                ? 'bg-brand-green/20 text-brand-green border-brand-green/40'
                : 'bg-navy-800 text-navy-300 border-navy-700 hover:border-navy-600'
            }`}
          >
            {p.name}
            {!p.base_resume_text && <span className="ml-1 text-[10px] text-navy-500">no resume</span>}
          </button>
        ))}
      </div>

      {/* Design preset picker */}
      <div className="mb-4">
        <span className="text-xs text-navy-500 uppercase tracking-wide mb-2 block">Design preset</span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {RESUME_PRESETS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => choosePreset(r.id)}
              className={`text-left rounded-lg border p-3 transition-colors ${
                preset === r.id
                  ? 'bg-brand-blue/15 border-brand-blue/50 text-navy-100'
                  : 'bg-navy-800 border-navy-700 text-navy-300 hover:border-navy-600'
              }`}
            >
              <div className="text-sm font-semibold">{r.label}</div>
              <div className="text-xs text-navy-500 mt-0.5">{r.note}</div>
            </button>
          ))}
        </div>
        {saving && <span className="text-xs text-navy-500 mt-1 inline-block">Saving…</span>}
        {status && (
          <div className={`mt-2 text-xs ${status.ok ? 'text-brand-green' : 'text-brand-red'}`}>{status.text}</div>
        )}
      </div>

      {/* Preview + download */}
      {clientId ? (
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          <div className="flex-1 w-full">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-navy-500 uppercase tracking-wide">Live preview</span>
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-brand-green text-navy-950 hover:bg-brand-greenDark"
              >
                Download / Open PDF
              </a>
            </div>
            <div className="rounded-lg border border-navy-700 bg-white h-[70vh] overflow-hidden shadow-panel">
              {selected?.base_resume_text ? (
                <iframe src={previewUrl} className="w-full h-full border-0" title="Resume preview" />
              ) : (
                <div className="h-full flex items-center justify-center text-navy-400 text-sm">
                  No resume uploaded for {selected?.name ?? 'this client'} yet.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-sm text-navy-400">No clients assigned to you.</div>
      )}
    </DashboardLayout>
  );
}