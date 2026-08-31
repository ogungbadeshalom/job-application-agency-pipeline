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