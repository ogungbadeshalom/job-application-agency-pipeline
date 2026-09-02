'use client';

import { useState, useMemo } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import {
  RESUME_PRESETS,
  RESUME_PRESET_STYLES,
  EMPTY_STRUCTURED_RESUME,
  type ResumePreset,
  type StructuredResume,
  type ResumeExperienceItem,
} from '@/lib/resume-presets';
import type { Role } from '@/lib/types';

interface NavItem { href: string; label: string; badge?: number }
interface Profile {
  id: string;
  name: string;
  resume_design?: string;
  resume_data?: StructuredResume | null;
  base_resume_text?: string | null;
}

// Lightweight preview fallback from base-resume prose (used only until the
// user edits/saves structured content).
function buildPreviewFromText(name: string, text: string): StructuredResume {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const titleLine = lines.find(
    (l) => !/^\s*\d/.test(l) && l.length > 3 && l.length < 90 && !/@/.test(l)
  );
  const title = titleLine && titleLine.toLowerCase() !== name.toLowerCase() ? titleLine : 'Professional / Engineer';
  const summaryLines = lines.filter((l) => l.length > 60).slice(0, 2);
  const summary = summaryLines.length
    ? summaryLines.join(' ')
    : (lines.find((l) => l.length > 30) || 'Experienced professional with a track record of delivering results.');
  const lower = text.toLowerCase();
  const skills =
    ['SQL', 'Python', 'AWS', 'Azure', 'GCP', 'Snowflake', 'Databricks', 'Spark', 'Kubernetes', 'Docker', 'TypeScript', 'React', 'Node.js', 'Machine Learning', 'ETL', 'Airflow', 'Terraform', 'PostgreSQL']
      .filter((s) => lower.includes(s.toLowerCase()))
      .slice(0, 10);
  return {
    contact: {
      name,
      title,
      email: 'you@example.com',
      phone: '',
      location: 'Remote (US)',
      linkedin: '',
      github: '',
      website: '',
    },
    summary: summaryLines.length ? summaryLines.join(' ') : 'Experienced professional with a track record of delivering results.',
    experience: [
      { role: title, company: 'Current / Most Recent Company', dates: '2022–Present', location: '', bullets: ['Led the design and delivery of production systems.', 'Collaborated cross-functionally to ship impactful features.'] },
      { role: title, company: 'Prior Company', dates: '2019–2022', location: '', bullets: ['Built and scaled core platforms.', 'Improved reliability and performance.'] },
    ],
    education: [],
    certifications: [],
    skills: skills.length ? skills : ['SQL', 'Python', 'Cloud', 'Data Pipelines', 'Collaboration'],
  };
}

const inputCls =
  'w-full text-sm bg-navy-950 border border-navy-700 rounded-md px-2.5 py-1.5 text-navy-100 placeholder:text-navy-500 focus:outline-none focus:border-brand-blue';
const labelCls = 'text-[10px] uppercase tracking-wide text-navy-500 mb-1 block';

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
  // Editor state — seeded from stored structured data, else derived from prose.
  const [data, setData] = useState<StructuredResume>(() =>
    clientProfiles[0]?.resume_data || (clientProfiles[0]?.base_resume_text
      ? buildPreviewFromText(clientProfiles[0].name || 'Your Name', clientProfiles[0].base_resume_text)
      : { ...EMPTY_STRUCTURED_RESUME, contact: { ...EMPTY_STRUCTURED_RESUME.contact, name: clientProfiles[0]?.name || '' } })
  );
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const selected = clientProfiles.find((p) => p.id === clientId);

  function selectClient(id: string) {
    const p = clientProfiles.find((x) => x.id === id);
    setClientId(id);
    setPreset((p?.resume_design as ResumePreset) || 'classic');
    setData(
      p?.resume_data ||
      (p?.base_resume_text
        ? buildPreviewFromText(p.name || 'Your Name', p.base_resume_text)
        : { ...EMPTY_STRUCTURED_RESUME, contact: { ...EMPTY_STRUCTURED_RESUME.contact, name: p?.name || '' } })
    );
    setDirty(false);
    setStatus(null);
  }

  function patch(patch: Partial<StructuredResume>) {
    setData((d) => ({ ...d, ...patch }));
    setDirty(true);
    setStatus(null);
  }
  function patchContact(f: string, v: string) {
    setData((d) => ({ ...d, contact: { ...d.contact, [f]: v } }));
    setDirty(true);
  }
  function setExperienceItem(i: number, f: string, v: string | string[]) {
    setData((d) => {
      const exp = [...d.experience];
      exp[i] = { ...exp[i], [f]: v };
      return { ...d, experience: exp };
    });
    setDirty(true);
  }
  function setExpBullet(i: number, bi: number, v: string) {
    setData((d) => {
      const exp = [...d.experience];
      const bullets = [...(exp[i].bullets || [])];
      bullets[bi] = v;
      exp[i] = { ...exp[i], bullets };
      return { ...d, experience: exp };
    });
    setDirty(true);
  }
  function addExp() {
    setData((d) => ({ ...d, experience: [...d.experience, { role: '', company: '', dates: '', location: '', bullets: [''] }] }));
    setDirty(true);
  }
  function removeExp(i: number) {
    setData((d) => ({ ...d, experience: d.experience.filter((_, x) => x !== i) }));
    setDirty(true);
  }
  function setEduItem(i: number, f: string, v: string) {
    setData((d) => {
      const education = [...d.education];
      education[i] = { ...education[i], [f]: v };
      return { ...d, education };
    });
    setDirty(true);
  }
  function addEdu() {
    setData((d) => ({ ...d, education: [...d.education, { school: '', degree: '', dates: '', detail: '' }] }));
    setDirty(true);
  }
  function removeEdu(i: number) {
    setData((d) => ({ ...d, education: d.education.filter((_, x) => x !== i) }));
    setDirty(true);
  }
  function setCertItem(i: number, f: string, v: string) {
    setData((d) => {
      const certifications = [...d.certifications];
      certifications[i] = { ...certifications[i], [f]: v };
      return { ...d, certifications };
    });
    setDirty(true);
  }
  function addCert() {
    setData((d) => ({ ...d, certifications: [...d.certifications, { name: '', issuer: '', year: '' }] }));
    setDirty(true);
  }
  function removeCert(i: number) {
    setData((d) => ({ ...d, certifications: d.certifications.filter((_, x) => x !== i) }));
    setDirty(true);
  }
  function setSkill(i: number, v: string) {
    setData((d) => {
      const skills = [...(d.skills || [])];
      skills[i] = v;
      return { ...d, skills };
    });
    setDirty(true);
  }
  function addSkill() {
    setData((d) => ({ ...d, skills: [...(d.skills || []), ''] }));
    setDirty(true);
  }
  function removeSkill(i: number) {
    setData((d) => ({ ...d, skills: d.skills.filter((_, x) => x !== i) }));
    setDirty(true);
  }

  async function save() {
    if (!clientId || !dirty) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/profiles/${clientId}/resume-data`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || 'Save failed');
      setDirty(false);
      setStatus({ ok: true, text: `Saved resume for ${selected?.name ?? 'this client'}.` });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
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
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  const style = RESUME_PRESET_STYLES[preset] ?? RESUME_PRESET_STYLES.classic;
  const single = clientProfiles.length <= 1;

  return (
    <DashboardLayout user={user} nav={nav} active="/client/resume-lab">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-pretty text-navy-100">Resume Lab</h1>
          <p className="text-sm text-navy-400 mt-1">
            Edit your resume content, choose a design, and preview it live. Saved once — used on all tailored resumes.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="px-4 py-2 text-sm font-medium rounded-md bg-brand-green text-navy-950 hover:bg-brand-greenDark disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : dirty ? 'Save resume' : 'Saved ✓'}
        </button>
      </div>

      {/* Client picker (only when the viewer manages several clients) */}
      {!single && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-navy-500 uppercase tracking-wide">Client</span>
          {(clientProfiles || []).map((p) => (
            <button key={p.id} type="button" onClick={() => selectClient(p.id)}
              className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                clientId === p.id ? 'bg-brand-green/20 text-brand-green border-brand-green/40'
                  : 'bg-navy-800 text-navy-300 border-navy-700 hover:border-navy-600'}`}>
              {p.name}
            </button>
          ))}
        </div>
      )}

      {status && (
        <div className={`mb-3 text-xs ${status.ok ? 'text-brand-green' : 'text-brand-red'}`}>{status.text}</div>
      )}

      {clientId ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {/* ---------- EDITOR ---------- */}
          <div className="space-y-4 lg:max-h-[78vh] lg:overflow-y-auto pr-1">
            {/* Design preset */}
            <div className="panel p-4">
              <span className={labelCls}>Design preset</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {RESUME_PRESETS.map((r) => (
                  <button key={r.id} type="button" onClick={() => choosePreset(r.id)}
                    className={`text-left rounded-lg border p-2.5 transition-colors ${
                      preset === r.id ? 'bg-brand-blue/15 border-brand-blue/50 text-navy-100'
                        : 'bg-navy-800 border-navy-700 text-navy-300 hover:border-navy-600'}`}>
                    <div className="text-xs font-semibold">{r.label}</div>
                    <div className="mt-1.5 h-1 w-8 rounded-full" style={{ backgroundColor: RESUME_PRESET_STYLES[r.id].accent }} />
                  </button>
                ))}
              </div>
            </div>

            {/* Contact */}
            <div className="panel p-4">
              <span className={labelCls}>Contact</span>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Full name"><input className={inputCls} value={data.contact.name} onChange={(e) => patchContact('name', e.target.value)} /></Field>
                <Field label="Title"><input className={inputCls} value={data.contact.title} onChange={(e) => patchContact('title', e.target.value)} /></Field>
                <Field label="Email"><input className={inputCls} value={data.contact.email} onChange={(e) => patchContact('email', e.target.value)} /></Field>
                <Field label="Phone"><input className={inputCls} value={data.contact.phone} onChange={(e) => patchContact('phone', e.target.value)} /></Field>
                <Field label="Location"><input className={inputCls} value={data.contact.location} onChange={(e) => patchContact('location', e.target.value)} /></Field>
                <Field label="Website"><input className={inputCls} value={data.contact.website} onChange={(e) => patchContact('website', e.target.value)} /></Field>
                <Field label="LinkedIn"><input className={inputCls} value={data.contact.linkedin} onChange={(e) => patchContact('linkedin', e.target.value)} /></Field>
                <Field label="GitHub"><input className={inputCls} value={data.contact.github} onChange={(e) => patchContact('github', e.target.value)} /></Field>
              </div>
            </div>

            {/* Summary */}
            <div className="panel p-4">
              <span className={labelCls}>Summary</span>
              <textarea className={inputCls + ' h-20 resize-y'} value={data.summary}
                onChange={(e) => patch({ summary: e.target.value })} placeholder="2–3 sentence professional summary" />
            </div>

            {/* Experience */}
            <div className="panel p-4">
              <div className="flex items-center justify-between mb-2">
                <span className={labelCls}>Experience</span>
                <button type="button" onClick={addExp} className="text-xs text-brand-blue hover:underline">+ Add</button>
              </div>
              {data.experience.length === 0 && <div className="text-xs text-navy-500">No experience yet.</div>}
              {data.experience.map((e, i) => (
                <ExpCard key={i} exp={e} idx={i} onSet={setExperienceItem} onBullet={setExpBullet} onRemove={removeExp} />
              ))}
            </div>

            {/* Education */}
            <div className="panel p-4">
              <div className="flex items-center justify-between mb-2">
                <span className={labelCls}>Education</span>
                <button type="button" onClick={addEdu} className="text-xs text-brand-blue hover:underline">+ Add</button>
              </div>
              {data.education.length === 0 && <div className="text-xs text-navy-500">No education added.</div>}
              {data.education.map((e, i) => (
                <div key={i} className="mb-3 p-2.5 rounded-md bg-navy-900/60 border border-navy-800 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="School"><input className={inputCls} value={e.school} onChange={(ev) => setEduItem(i, 'school', ev.target.value)} /></Field>
                    <Field label="Degree"><input className={inputCls} value={e.degree} onChange={(ev) => setEduItem(i, 'degree', ev.target.value)} /></Field>
                    <Field label="Dates"><input className={inputCls} value={e.dates} onChange={(ev) => setEduItem(i, 'dates', ev.target.value)} /></Field>
                    <Field label="Detail"><input className={inputCls} value={e.detail} onChange={(ev) => setEduItem(i, 'detail', ev.target.value)} /></Field>
                  </div>
                  <button type="button" onClick={() => removeEdu(i)} className="text-xs text-brand-red hover:underline">Remove</button>
                </div>
              ))}
            </div>

            {/* Certifications */}
            <div className="panel p-4">
              <div className="flex items-center justify-between mb-2">
                <span className={labelCls}>Certifications</span>
                <button type="button" onClick={addCert} className="text-xs text-brand-blue hover:underline">+ Add</button>
              </div>
              {data.certifications.length === 0 && <div className="text-xs text-navy-500">No certifications.</div>}
              {data.certifications.map((c, i) => (
                <div key={i} className="mb-3 p-2.5 rounded-md bg-navy-900/60 border border-navy-800 space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Name"><input className={inputCls} value={c.name} onChange={(ev) => setCertItem(i, 'name', ev.target.value)} /></Field>
                    <Field label="Issuer"><input className={inputCls} value={c.issuer} onChange={(ev) => setCertItem(i, 'issuer', ev.target.value)} /></Field>
                    <Field label="Year"><input className={inputCls} value={c.year} onChange={(ev) => setCertItem(i, 'year', ev.target.value)} /></Field>
                  </div>
                  <button type="button" onClick={() => removeCert(i)} className="text-xs text-brand-red hover:underline">Remove</button>
                </div>
              ))}
            </div>

            {/* Skills */}
            <div className="panel p-4">
              <div className="flex items-center justify-between mb-2">
                <span className={labelCls}>Skills</span>
                <button type="button" onClick={addSkill} className="text-xs text-brand-blue hover:underline">+ Add</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {(data.skills || []).map((s, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-md bg-navy-800 px-2 py-1">
                    <input className="w-28 text-xs bg-transparent outline-none text-navy-100 border-b border-transparent focus:border-brand-blue"
                      value={s} onChange={(e) => setSkill(i, e.target.value)} />
                    <button type="button" onClick={() => removeSkill(i)} className="text-navy-500 hover:text-brand-red text-sm leading-none">×</button>
                  </span>
                ))}
              </div>
            </div>
            <div className="h-4" />
          </div>

          {/* ---------- PREVIEW ---------- */}
          <div className="sticky top-4">
            <div className="rounded-lg border border-navy-700 bg-white overflow-hidden shadow-panel">
              <div className="h-[76vh] overflow-y-auto">
                <div className="max-w-[820px] mx-auto my-4 bg-white">
                  <div style={{ padding: '34px 44px', fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 10, lineHeight: 1.45, color: style.body }}>
                    <div style={{ textAlign: 'center', marginBottom: 18 }}>
                      <div style={{ fontSize: style.nameSize, fontWeight: 700, lineHeight: 1.1, color: style.name }}>
                        {data.contact.name || 'Your Name'}
                      </div>
                      <div style={{ fontSize: style.titleSize, color: style.title, fontWeight: 600, marginTop: 6 }}>
                        {data.contact.title}
                      </div>
                      <div style={{ fontSize: 9.5, color: style.muted, marginTop: 5 }}>
                        {[data.contact.email, data.contact.phone, data.contact.location, data.contact.website, data.contact.linkedin, data.contact.github].filter(Boolean).join(' · ')}
                      </div>
                      <div style={{ borderBottom: `${style.ruleWidth}px solid ${style.accent}`, marginTop: 14 }} />
                    </div>

                    {data.summary && <Section style={style} title="Summary" />}
                    {data.summary && <div style={{ fontSize: 10, marginBottom: 7, lineHeight: 1.4 }}>{data.summary}</div>}

                    {data.experience.length > 0 && <Section style={style} title="Experience" />}
                    {data.experience.map((e, i) => (
                      <div key={i} style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 11.5, fontWeight: 700 }}>{e.role}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: style.muted, marginTop: 1 }}>
                          <span style={{ fontStyle: 'italic', fontWeight: 700, color: '#333' }}>
                            {[e.company, e.location].filter(Boolean).join(' · ')}
                          </span>
                          <span>{e.dates}</span>
                        </div>
                        {(e.bullets || []).filter((b) => b.trim()).map((b, bi) => (
                          <div key={bi} style={{ fontSize: 9.6, paddingLeft: 11, marginTop: 3 }}>
                            <span style={{ position: 'absolute', marginLeft: -11 }}>•</span> {b}
                          </div>
                        ))}
                      </div>
                    ))}

                    {data.education.length > 0 && <Section style={style} title="Education" />}
                    {data.education.map((e, i) => (
                      <div key={i} style={{ fontSize: 9.6, marginBottom: 6 }}>
                        <span style={{ fontWeight: 700 }}>{e.degree}</span>
                        {e.school && <span> — {e.school}</span>}
                        {e.dates && <span style={{ color: style.muted }}> · {e.dates}</span>}
                        {e.detail && <div style={{ color: style.muted }}>{e.detail}</div>}
                      </div>
                    ))}

                    {data.certifications.length > 0 && <Section style={style} title="Certifications" />}
                    {data.certifications.map((c, i) => (
                      <div key={i} style={{ fontSize: 9.6, marginBottom: 4 }}>
                        {c.name}{c.issuer && <span> — {c.issuer}</span>}{c.year && <span style={{ color: style.muted }}> · {c.year}</span>}
                      </div>
                    ))}

                    {data.skills && data.skills.length > 0 && <Section style={style} title="Skills" />}
                    <div style={{ paddingLeft: 11 }}>
                      {data.skills.filter((s) => s.trim()).map((s, i) => (
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
                <a href={`/api/resume-preview?profileId=${clientId}&preset=${preset}`} target="_blank" rel="noreferrer"
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-brand-green text-navy-950 hover:bg-brand-greenDark">
                  Download / Open PDF
                </a>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-navy-700 bg-navy-900 h-[40vh] flex items-center justify-center text-navy-400 text-sm">
          No resume available.
        </div>
      )}
    </DashboardLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wide text-navy-500 mb-1 block">{label}</span>
      {children}
    </div>
  );
}

function ExpCard({
  exp, idx, onSet, onBullet, onRemove,
}: {
  exp: ResumeExperienceItem;
  idx: number;
  onSet: (i: number, f: string, v: string | string[]) => void;
  onBullet: (i: number, bi: number, v: string) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="mb-3 p-2.5 rounded-md bg-navy-900/60 border border-navy-800 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Role"><input className={inputCls} value={exp.role} onChange={(e) => onSet(idx, 'role', e.target.value)} /></Field>
        <Field label="Company"><input className={inputCls} value={exp.company} onChange={(e) => onSet(idx, 'company', e.target.value)} /></Field>
        <Field label="Dates"><input className={inputCls} value={exp.dates} onChange={(e) => onSet(idx, 'dates', e.target.value)} /></Field>
        <Field label="Location"><input className={inputCls} value={exp.location} onChange={(e) => onSet(idx, 'location', e.target.value)} /></Field>
      </div>
      {/* bullets */}
      {exp.bullets.map((b, bi) => (
        <input key={bi} className={inputCls} value={b} placeholder={`Bullet ${bi + 1}`}
          onChange={(e) => onBullet(idx, bi, e.target.value)} />
      ))}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => onSet(idx, 'bullets', [...(exp.bullets || []), ''])}
          className="text-xs text-brand-blue hover:underline">+ Bullet</button>
        <button type="button" onClick={() => onRemove(idx)} className="text-xs text-brand-red hover:underline">Remove</button>
      </div>
    </div>
  );
}

function Section({ style, title }: { style: { accent: string; sectionSize: number }; title: string }) {
  return (
    <div
      style={{
        fontSize: style.sectionSize, color: style.accent, fontWeight: 700,
        borderBottom: '1px solid #cbd5e1', marginBottom: 7, paddingBottom: 4, marginTop: 12, letterSpacing: 0.3,
      }}
    >
      {title}
    </div>
  );
}