// Resume design presets — plain TS module (no react-pdf) so it can be imported
// by client components and API routes without pulling the PDF renderer into the
// client bundle.

export type ResumePreset = 'classic' | 'modern' | 'bold' | 'minimal';

export const RESUME_PRESETS: { id: ResumePreset; label: string; note: string }[] = [
  { id: 'classic', label: 'Classic', note: 'Traditional blue-accent sections' },
  { id: 'modern', label: 'Modern', note: 'Teal accent, airy spacing' },
  { id: 'bold', label: 'Bold / Tech', note: 'Big headings, high contrast' },
  { id: 'minimal', label: 'Minimal', note: 'Clean grayscale, thin rules' },
];

export function isResumePreset(v: unknown): v is ResumePreset {
  return RESUME_PRESETS.some((r) => r.id === v);
}

// Client-safe styling per preset (mirrors the PDF palette in resume-pdf.tsx).
// Kept in this plain-TS module so the HTML live-preview can match the actual
// generated PDF without pulling react-pdf into the client bundle.
export interface ResumePresetStyle {
  accent: string;
  nameSize: number;
  titleSize: number;
  sectionSize: number;
  ruleWidth: number;
  name: string;
  title: string;
  body: string;
  muted: string;
}

export const RESUME_PRESET_STYLES: Record<ResumePreset, ResumePresetStyle> = {
  classic: { accent: '#2a5f8f', nameSize: 26, titleSize: 14, sectionSize: 14, ruleWidth: 1.5, name: '#111', title: '#2a5f8f', body: '#222', muted: '#444' },
  modern:  { accent: '#0f766e', nameSize: 26, titleSize: 14, sectionSize: 13, ruleWidth: 2,   name: '#111', title: '#0f766e', body: '#222', muted: '#444' },
  bold:    { accent: '#111111', nameSize: 30, titleSize: 15, sectionSize: 15, ruleWidth: 2.5, name: '#111', title: '#111111', body: '#1a1a1a', muted: '#333' },
  minimal: { accent: '#616161', nameSize: 24, titleSize: 13, sectionSize: 12, ruleWidth: 0.6, name: '#111', title: '#616161', body: '#222', muted: '#444' },
};

// ---- Structured, editable resume content (Resume Lab) --------------------
// This is the single source of truth for the Resume Lab editor -> preview ->
// PDF pipeline. Stored per-client as JSON (profiles.resume_data). Sections are
// plain PascalCase JSON keys so the editor can render them generically.

export interface ResumeContact {
  name: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
  website: string;
}

export interface ResumeExperienceItem {
  role: string;
  company: string;
  dates: string;
  location: string;
  bullets: string[];
}

export interface ResumeEducationItem {
  school: string;
  degree: string;
  dates: string;
  detail: string;
}

export interface ResumeCertificationItem {
  name: string;
  issuer: string;
  year: string;
}

// Grouped skill categories rendered as a TECHNICAL SKILLS section before Experience.
export interface ResumeTechnicalSkillGroup {
  category: string;
  items: string;
}

export interface StructuredResume {
  contact: ResumeContact;
  summary: string;
  experience: ResumeExperienceItem[];
  education: ResumeEducationItem[];
  certifications: ResumeCertificationItem[];
  skills: string[];
  technicalSkills: ResumeTechnicalSkillGroup[];
}

export const EMPTY_STRUCTURED_RESUME: StructuredResume = {
  contact: { name: '', title: '', email: '', phone: '', location: '', linkedin: '', github: '', website: '' },
  summary: '',
  experience: [],
  education: [],
  certifications: [],
  skills: [],
  technicalSkills: [],
};

// Upgrade legacy resume_data (old flat format: top-level name/email/title,
// exp {title,start,end}, edu {degree,school}) into the current StructuredResume
// shape so the Resume Lab never crashes on undefined `contact`. Idempotent:
// already-new-shape input passes through untouched.
export function normalizeStructuredResume(raw: unknown): StructuredResume {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STRUCTURED_RESUME };
  const r = raw as Record<string, any>;

  // Legacy flat format has no nested `contact` object -> rebuild everything.
  if (r.contact && typeof r.contact === 'object') {
    return {
      contact: { ...EMPTY_STRUCTURED_RESUME.contact, ...r.contact },
      summary: typeof r.summary === 'string' ? r.summary : '',
      experience: Array.isArray(r.experience) ? r.experience : [],
      education: Array.isArray(r.education) ? r.education : [],
      certifications: Array.isArray(r.certifications) ? r.certifications : [],
      skills: Array.isArray(r.skills) ? r.skills : [],
      technicalSkills: Array.isArray(r.technicalSkills) ? r.technicalSkills : [],
    };
  }

  const open = (o: any) => (typeof o === 'string' ? o : o === undefined || o === null ? '' : String(o));
  const exp = Array.isArray(r.experience)
    ? r.experience.map((e: any = {}) => ({
        role: open(e.title ?? e.role),
        company: open(e.company),
        dates: e.end === 'Present' ? `${open(e.start ?? '')}–Present` : e.dates ? open(e.dates) : [open(e.start ?? ''), open(e.end ?? '')].filter(Boolean).join('–'),
        location: open(e.location),
        bullets: Array.isArray(e.bullets) ? e.bullets.map(open) : [],
      }))
    : [];
  const edu = Array.isArray(r.education)
    ? r.education.map((e: any = {}) => ({ school: open(e.school), degree: open(e.degree), dates: open(e.dates), detail: open(e.detail) }))
    : [];
  const certs = Array.isArray(r.certifications)
    ? r.certifications.map((c: any = {}) => ({ name: open(c.name), issuer: open(c.issuer), year: open(c.year) }))
    : [];
  return {
    contact: {
      name: open(r.name),
      title: open(r.title),
      email: open(r.email),
      phone: open(r.phone),
      location: open(r.location),
      linkedin: open(r.linkedin),
      github: open(r.github),
      website: open(r.website),
    },
    summary: Array.isArray(r.summary_lines) ? r.summary_lines.join(' ') : typeof r.summary === 'string' ? r.summary : '',
    experience: exp,
    education: edu,
    certifications: certs,
    skills: Array.isArray(r.skills) ? r.skills.map(open) : [],
    technicalSkills: Array.isArray(r.technicalSkills)
      ? r.technicalSkills.map((g: any = {}) => ({ category: open(g.category ?? g.group), items: Array.isArray(g.items) ? g.items.join(', ') : open(g.skills ? (Array.isArray(g.skills) ? g.skills.join(', ') : g.skills) : g.items) }))
      : [],
  };
}