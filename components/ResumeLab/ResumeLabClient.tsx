'use client';

import { useState, useMemo } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { RESUME_PRESETS, RESUME_PRESET_STYLES, type ResumePreset } from '@/lib/resume-presets';
import type { Role } from '@/lib/types';

interface NavItem { href: string; label: string; badge?: number }
interface Profile { id: string; name: string; resume_design?: string; base_resume_text?: string | null }

// Lightweight preview data from the base-resume prose (same idea as the
// server's previewData). Good enough to judge the letterhead + section styling.
function buildPreview(name: string, text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const titleLine = lines.find(
    (l) => !/^\s*\d/.test(l) && l.length > 3 && l.length < 90 && !/@/.test(l)
  );
  const title =
    titleLine && titleLine.toLowerCase() !== name.toLowerCase()
      ? titleLine
      : 'Professional / Engineer';
  const summaryLines = lines.filter((l) => l.length > 60).slice(0, 2);
  const summary = summaryLines.length
    ? summaryLines
    : [lines.find((l) => l.length > 30) || 'Experienced professional with a track record of delivering results.'];
  const lower = text.toLowerCase();
  const skills =
    ['SQL', 'Python', 'AWS', 'Azure', 'GCP', 'Snowflake', 'Databricks', 'Spark', 'Kubernetes', 'Docker', 'TypeScript', 'React', 'Node.js', 'Machine Learning', 'ETL', 'Airflow', 'Terraform', 'PostgreSQL']
      .filter((s) => lower.includes(s.toLowerCase()))
      .slice(0, 10);
  return {
    name,
    title,
    contact: 'you@example.com · Remote (US)',
    summary,
    experience: [
      { role: title, company: 'Current / Most Recent Company', dates: '2022–Present' },
      { role: title, company: 'Prior Company', dates: '2019–2022' },
    ],
    skills: skills.length ? skills : ['SQL', 'Python', 'Cloud', 'Data Pipelines', 'Collaboration'],
  };
}

// A page (A4-ish, white) rendered with the chosen preset's real palette.
// Pure inline styles so it always matches the generated PDF and never triggers
// a browser download (unlike the old PDF-in-iframe preview).
export default function ResumeLabClient({
  user,
  nav,
  clientProfiles,
}: {
  user: { full_name: string; email: string; role: Role; accent: string };
  nav: NavItem[];
  clientProfiles: Profile[];
}) {
  const [clientId, setClientId] = useState<string>(clientProfiles[0]?.id ?? '');
  const [preset, setPreset] = useState<ResumePreset>(
    (clientProfiles[0]?.resume_design as ResumePreset) || 'classic'
  );
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const selected = clientProfiles.find((p) => p.id === clientId);

  function selectClient(id: string) {
    const p = clientProfiles.find((x) => x.id === id);
    setClientId(id);
    setPreset((p?.resume_design as ResumePreset) || 'classic');
    setStatus(null);
  }

  async function choosePreset(next: ResumePreset) {
    setPreset(next);
    if (!clientId) return;
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

  const style = RESUME_PRESET_STYLES[preset] ?? RESUME_PRESET_STYLES.classic;
  const preview = selected?.base_resume_text
    ? buildPreview(selected.name || 'Your Name', selected.base_resume_text)
    : null;

  const single = clientProfiles.length <= 1;

  return (
    <DashboardLayout user={user} nav={nav} active="/client/resume-lab">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-pretty text-navy-100">Resume Lab</h1>
        <p className="text-sm text-navy-400 mt-1">
          Preview your resume and choose a design style. Your choice is used on all your tailored resumes.
        </p>
      </div>

      {/* Client picker (only when the viewer manages several clients) */}
      {!single && (
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
      )}

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
              {/* tiny accent swatch so the design hint is visible */}
              <div
                className="mt-2 h-1 w-10 rounded-full"
                style={{ backgroundColor: RESUME_PRESET_STYLES[r.id].accent }}
              />
            </button>
          ))}
        </div>
        {saving && <span className="text-xs text-navy-500 mt-1 inline-block">Saving…</span>}
        {status && (
          <div className={`mt-2 text-xs ${status.ok ? 'text-brand-green' : 'text-brand-red'}`}>{status.text}</div>
        )}
      </div>

      {/* Live preview (inline HTML — no PDF, no auto-download) */}
      {clientId && preview ? (
        <div className="rounded-lg border border-navy-700 bg-white overflow-hidden shadow-panel">
          <div className="h-[72vh] overflow-y-auto">
            <div className="max-w-[820px] mx-auto my-4 bg-white">
              {/* resume body */}
              <div style={{ padding: '34px 44px', fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 10, lineHeight: 1.45, color: style.body }}>
                <div style={{ textAlign: 'center', marginBottom: 18 }}>
                  <div style={{ fontSize: style.nameSize, fontWeight: 700, lineHeight: 1.1, color: style.name }}>
                    {preview.name}
                  </div>
                  <div style={{ fontSize: style.titleSize, color: style.title, fontWeight: 600, marginTop: 6 }}>
                    {preview.title}
                  </div>
                  <div style={{ fontSize: 9.5, color: style.muted, marginTop: 5 }}>{preview.contact}</div>
                  <div style={{ borderBottom: `${style.ruleWidth}px solid ${style.accent}`, marginTop: 14 }} />
                </div>

                <Section style={style} title="Summary" />
                {preview.summary.map((p, i) => (
                  <div key={i} style={{ fontSize: 10, marginBottom: 7, lineHeight: 1.4 }}>{p}</div>
                ))}

                <Section style={style} title="Experience" />
                {preview.experience.map((e, i) => (
                  <div key={i} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700 }}>{e.role}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: style.muted, marginTop: 1 }}>
                      <span style={{ fontStyle: 'italic', fontWeight: 700, color: '#333' }}>{e.company}</span>
                      <span>{e.dates}</span>
                    </div>
                    <div style={{ fontSize: 9.6, paddingLeft: 11, marginTop: 4 }}>
                      <span style={{ position: 'absolute', marginLeft: -11 }}>•</span> Led the design and delivery of production systems.
                    </div>
                    <div style={{ fontSize: 9.6, paddingLeft: 11, marginTop: 3 }}>
                      <span style={{ position: 'absolute', marginLeft: -11 }}>•</span> Collaborated cross-functionally to ship impactful features.
                    </div>
                  </div>
                ))}

                <Section style={style} title="Skills" />
                <div style={{ paddingLeft: 11 }}>
                  {preview.skills.map((s, i) => (
                    <div key={i} style={{ fontSize: 9.6, marginBottom: 3 }}>
                      <span style={{ position: 'absolute', marginLeft: -11 }}>•</span> {s}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-navy-700 bg-navy-900">
            <span className="text-xs text-navy-400">Live preview — {RESUME_PRESETS.find((r) => r.id === preset)?.label}</span>
            <a
              href={`/api/resume-preview?profileId=${clientId}&preset=${preset}`}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-brand-green text-navy-950 hover:bg-brand-greenDark"
            >
              Download / Open PDF
            </a>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-navy-700 bg-navy-900 h-[40vh] flex items-center justify-center text-navy-400 text-sm">
          {clientId ? 'No resume uploaded yet.' : 'No resume available.'}
        </div>
      )}
    </DashboardLayout>
  );
}

function Section({ style, title }: { style: { accent: string; sectionSize: number; ruleWidth: number }; title: string }) {
  return (
    <div
      style={{
        fontSize: style.sectionSize,
        color: style.accent,
        fontWeight: 700,
        borderBottom: '1px solid #cbd5e1',
        marginBottom: 7,
        paddingBottom: 4,
        marginTop: 12,
        letterSpacing: 0.3,
      }}
    >
      {title}
    </div>
  );
}