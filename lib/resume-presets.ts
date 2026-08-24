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