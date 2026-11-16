// Server-side PDF rendering for tailored resumes, using @react-pdf/renderer.
// Takes structured resume data (the shape the AI returns) and produces a clean
// A4 PDF binary. Supports 4 design presets (Classic / Modern / Bold / Minimal)
// chosen per-client. Section headings are sized to stand out clearly.
import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  renderToBuffer,
} from '@react-pdf/renderer';

import type { ResumePreset, StructuredResume } from './resume-presets';
export type { ResumePreset } from './resume-presets';
export { RESUME_PRESETS, isResumePreset } from './resume-presets';

// Never split words with auto-hyphenation across line breaks (react-pdf's
// English hyphenation dictionary would otherwise render "opportuni-ties").
Font.registerHyphenationCallback((word) => [word]);

// ---- Structured shape the AI must produce --------------------------------
export interface ResumeData {
  name: string;
  title: string;
  contact: string;
  summary: string[];
  experience: {
    role: string;
    company: string;
    dates: string;
    location?: string;
    description?: string;
    technologies?: string;
    bullets: string[];
  }[];
  education: {
    school: string;
    degree: string;
    dates: string;
    detail: string;
  }[];
  certifications: {
    name: string;
    issuer: string;
    year: string;
  }[];
  skills: string[];
  technicalSkills?: {
    category: string;
    items: string;
  }[];
}

// Each preset = an accent color + heading treatment + spacing feel.
interface PresetPalette {
  accent: string;
  nameSize: number;
  titleSize: number;
  sectionSize: number;
  ruleWidth: number;
  sectionPadding: number;
  headerMargin: number;
  font: string;
  titleFont: string;
}

const PALETTES: Record<ResumePreset, PresetPalette> = {
  kevin: {
    accent: '#111827',
    nameSize: 28,
    titleSize: 12.5,
    sectionSize: 12.5,
    ruleWidth: 0.8,
    sectionPadding: 2,
    headerMargin: 12,
    font: 'Helvetica',
    titleFont: 'Helvetica-Bold',
  },
  classic: {
    accent: '#2a5f8f',
    nameSize: 26,
    titleSize: 14,
    sectionSize: 14,
    ruleWidth: 1.5,
    sectionPadding: 4,
    headerMargin: 16,
    font: 'Helvetica',
    titleFont: 'Helvetica-Bold',
  },
  modern: {
    accent: '#0f766e',
    nameSize: 26,
    titleSize: 14,
    sectionSize: 13,
    ruleWidth: 2,
    sectionPadding: 4,
    headerMargin: 18,
    font: 'Helvetica',
    titleFont: 'Helvetica-Bold',
  },
  bold: {
    accent: '#111111',
    nameSize: 30,
    titleSize: 15,
    sectionSize: 15,
    ruleWidth: 2.5,
    sectionPadding: 5,
    headerMargin: 18,
    font: 'Helvetica', // body stays regular; headings use Helvetica-Bold explicitly
    titleFont: 'Helvetica-Bold',
  },
  minimal: {
    accent: '#616161',
    nameSize: 24,
    titleSize: 13,
    sectionSize: 12,
    ruleWidth: 0.6,
    sectionPadding: 3,
    headerMargin: 14,
    font: 'Helvetica',
    titleFont: 'Helvetica-Bold',
  },
};

export function makeResumeStyles(preset: ResumePreset) {
  const p = PALETTES[preset] ?? PALETTES.classic;
  return StyleSheet.create({
    page: {
      paddingTop: 36,
      paddingBottom: 36,
      paddingLeft: 40,
      paddingRight: 40,
      fontFamily: p.font,
      fontSize: 10,
      lineHeight: 1.4,
      color: '#222',
    },
    header: { textAlign: 'center', marginBottom: p.headerMargin },
    name: {
      fontSize: p.nameSize,
      textAlign: 'center',
      fontFamily: 'Helvetica-Bold',
      marginBottom: 6,
      lineHeight: 1.1,
      color: '#111',
    },
    title: {
      fontSize: p.titleSize,
      textAlign: 'center',
      color: p.accent,
      marginBottom: 5,
      fontFamily: p.titleFont,
    },
    contact: { fontSize: 9.5, textAlign: 'center', color: '#444', marginBottom: 0 },
    headerRule: {
      borderBottomWidth: p.ruleWidth,
      borderBottomColor: p.accent,
      marginTop: 14,
      marginBottom: 14,
    },
    sectionT: {
      fontSize: p.sectionSize,
      color: p.accent,
      fontWeight: 'bold',
      borderBottomWidth: 1,
      borderBottomColor: '#cbd5e1',
      marginBottom: 7,
      paddingBottom: p.sectionPadding,
      marginTop: 12,
      letterSpacing: 0.3,
    },
    summary: { fontSize: 10, marginBottom: 7, textAlign: 'left', lineHeight: 1.4 },
    expBlock: { marginBottom: 12 },
    roleRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1 },
    roleText: { fontSize: 11.5, fontWeight: 'bold' },
    company: { fontSize: 10, color: '#333', fontStyle: 'italic', fontWeight: 'bold' },
    dates: { fontSize: 9, color: '#666' },
    bullet: { flexDirection: 'row', marginBottom: 3, paddingLeft: 11 },
    bulletDot: { width: 8, fontSize: 10, marginLeft: -11 },
    bulletText: { flex: 1, fontSize: 9.6, textAlign: 'justify' },
    skillRow: { flexDirection: 'row', marginBottom: 3, paddingLeft: 11 },
    skillDot: { width: 8, fontSize: 10, marginLeft: -11 },
    skills: { flex: 1, fontSize: 9.6 },
  });
}

// ---- Engraved (Kevin) preset: faithful to the approved Helvetica design. ----
// US Letter, left-aligned name + contact, uppercase ruled section headers,
// two-line job blocks (company|location / role|dates), hanging bullets.
const engraved = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 44, paddingLeft: 46, paddingRight: 46, fontFamily: 'Helvetica', fontSize: 10, lineHeight: 1.35, color: '#1f2937' },
  name: { fontSize: 28, fontFamily: 'Helvetica-Bold', color: '#111827', lineHeight: 1.05, marginBottom: 14 },
  contact: { fontSize: 10.5, color: '#6b7280', marginBottom: 16 },
  section: {
    fontSize: 12.5, fontFamily: 'Helvetica-Bold', color: '#111827', textTransform: 'uppercase',
    borderBottomWidth: 0.8, borderBottomColor: '#111827', letterSpacing: 0.5, paddingBottom: 3, marginBottom: 7, marginTop: 14,
  },
  sum: { fontSize: 10, lineHeight: 1.35, textAlign: 'left' },
  skillGroup: { flexDirection: 'row', marginBottom: 2 },
  skillLbl: { fontFamily: 'Helvetica-Bold', color: '#111827' },
  skillVal: { flex: 1 },
  job: { marginBottom: 10 },
  jline1: { flexDirection: 'row', justifyContent: 'space-between' },
  jrole: { fontFamily: 'Helvetica-Bold', color: '#111827', fontSize: 10.5 },
  jcomp: { fontStyle: 'italic', color: '#1f2937' },
  jloc: { fontSize: 9.5, color: '#6b7280' },
  jdates: { fontSize: 9.5, color: '#6b7280' },
  jline2: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 1 },
  jdesc: { fontSize: 9.6, lineHeight: 1.35, color: '#1f2937', marginTop: 3 },
  kc: { fontFamily: 'Helvetica-Bold', color: '#111827', marginTop: 6 },
  tech: { fontSize: 9.5, marginTop: 3, color: '#1f2937' },
  techLbl: { fontFamily: 'Helvetica-Bold', color: '#111827' },
  bullet: { flexDirection: 'row', marginBottom: 2, paddingLeft: 14 },
  bulletDot: { width: 9, fontSize: 10, marginLeft: -14 },
  bulletText: { flex: 1, fontSize: 9.6, textAlign: 'left' },
  eduRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1 },
  eduInst: { fontFamily: 'Helvetica-Bold', color: '#111827' },
  eduD: { fontSize: 9.5, color: '#6b7280' },
  cert: { flexDirection: 'row', marginBottom: 2, paddingLeft: 14 },
  certDot: { width: 9, fontSize: 10, marginLeft: -14 },
  certText: { flex: 1, fontSize: 9.6 },
});

function EngravedResumeDoc({ d }: { d: ResumeData }) {
  const showTech = d.technicalSkills && d.technicalSkills.length > 0;
  return (
    <Document>
      <Page size="LETTER" style={engraved.page}>
        <Text style={engraved.name}>{d.name || ''}</Text>
        <Text style={engraved.contact}>{d.contact || ''}</Text>

        <Text style={engraved.section}>Professional Summary</Text>
        {(d.summary || []).map((p, i) => (
          <Text key={i} style={engraved.sum}>{p}</Text>
        ))}

        {showTech ? (
          <><Text style={engraved.section}>Technical Skills</Text>
          {(d.technicalSkills || []).map((g, gi) => (
            <View key={gi} style={engraved.skillGroup}>
              <Text style={engraved.skillLbl}>{g.category}: </Text>
              <Text style={engraved.skillVal}>{g.items}</Text>
            </View>
          ))}</>
        ) : (d.skills && d.skills.length > 0) ? (
          <><Text style={engraved.section}>Technical Skills</Text>
          {(d.skills || []).map((s, si) => (
            <Text key={si} style={engraved.sum}>{s}</Text>
          ))}</>
        ) : null}

        <Text style={engraved.section}>Work Experience</Text>
        {(d.experience || []).map((e, ei) => (
          <View key={ei} style={engraved.job} wrap={false}>
            <View style={engraved.jline1}>
              <Text style={engraved.jrole}>{e.role || ''}</Text>
              <Text style={engraved.jdates}>{e.dates || ''}</Text>
            </View>
            <View style={engraved.jline2}>
              <Text style={engraved.jcomp}>{e.company || ''}</Text>
              {e.location ? <Text style={engraved.jloc}>{e.location}</Text> : null}
            </View>
            {e.description ? <Text style={engraved.jdesc}>{e.description}</Text> : null}
            <Text style={engraved.kc}>Key Contributions</Text>
            {(e.bullets || []).map((b, bi) => (
              <View key={bi} style={engraved.bullet}>
                <Text style={engraved.bulletDot}>{'\u2022'}</Text>
                <Text style={engraved.bulletText}>{b}</Text>
              </View>
            ))}
            {e.technologies ? (
              <Text style={engraved.tech}><Text style={engraved.techLbl}>Technologies:</Text>{' '}{e.technologies}</Text>
            ) : null}
          </View>
        ))}

        {(d.education && d.education.length > 0) && (
          <><Text style={engraved.section}>Education</Text>
          {(d.education || []).map((e, ei) => (
            <View key={ei} wrap={false}>
              <View style={engraved.eduRow}>
                <Text style={engraved.eduInst}>{e.school || e.degree}</Text>
                <Text style={engraved.eduD}>{e.dates}</Text>
              </View>
              {e.degree && e.degree !== e.school ? <Text style={{ fontSize: 9.6 }}>{e.degree}</Text> : null}
              {e.detail ? <Text style={engraved.sum}>{e.detail}</Text> : null}
            </View>
          ))}</>
        )}

        {(d.certifications && d.certifications.length > 0) && (
          <><Text style={engraved.section}>Certifications</Text>
          {d.certifications.map((c, ci) => (
            <View key={ci} style={engraved.cert}>
              <Text style={engraved.certDot}>{'\u2022'}</Text>
              <Text style={engraved.certText}>{c.name}{c.issuer ? ` — ${c.issuer}` : ''}{c.year ? ` · ${c.year}` : ''}</Text>
            </View>
          ))}</>
        )}
      </Page>
    </Document>
  );
}

function ResumeDoc({ d, preset }: { d: ResumeData; preset: ResumePreset }) {
  if (preset === 'kevin') return <EngravedResumeDoc d={d} />;
  const styles = makeResumeStyles(preset);
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.name}>{d.name || ''}</Text>
          <Text style={styles.title}>{d.title || ''}</Text>
          <Text style={styles.contact}>{d.contact || ''}</Text>
        </View>
        <View style={styles.headerRule} />

        <Text style={styles.sectionT}>Summary</Text>
        {(d.summary || []).map((p, i) => (
          <Text key={i} style={styles.summary}>{p}</Text>
        ))}

        {(d.technicalSkills && d.technicalSkills.length > 0) && (
          <>
            <Text style={styles.sectionT}>Technical Skills</Text>
            {(d.technicalSkills || []).map((g, gi) => (
              <Text key={gi} style={styles.summary}>
                <Text style={{ fontWeight: 'bold' }}>{g.category}: </Text>
                {g.items}
              </Text>
            ))}
          </>
        )}

        {(d.skills && d.skills.length > 0 && !(d.technicalSkills && d.technicalSkills.length > 0)) && (
          <>
            <Text style={styles.sectionT}>Technical Skills</Text>
            {(d.skills || []).map((s, si) => (
              <Text key={si} style={styles.summary}>{s}</Text>
            ))}
          </>
        )}

        <Text style={styles.sectionT}>Experience</Text>
        {(d.experience || []).map((e, ei) => (
          <View key={ei} style={styles.expBlock} wrap={false}>
            <View style={styles.roleRow}>
              <Text style={styles.roleText}>{e.role}</Text>
            </View>
            <View style={styles.roleRow}>
              <Text style={styles.company}>{e.company}</Text>
              <Text style={styles.dates}>{e.dates}</Text>
            </View>
            {(e.bullets || []).map((b, bi) => (
              <View key={bi} style={styles.bullet}>
                <Text style={styles.bulletDot}>{'\u2022'}</Text>
                <Text style={styles.bulletText}>{b}</Text>
              </View>
            ))}
          </View>
        ))}

        {(d.education && d.education.length > 0) && (
          <View wrap={false}>
            <Text style={styles.sectionT}>Education</Text>
            {(d.education || []).map((e, ei) => (
              <View key={ei} style={styles.expBlock}>
                <View style={styles.roleRow}>
                  <Text style={styles.roleText}>{e.degree || e.school}</Text>
                </View>
                <View style={styles.roleRow}>
                  <Text style={styles.company}>{e.school}</Text>
                  <Text style={styles.dates}>{e.dates}</Text>
                </View>
                {e.detail ? <Text style={styles.summary}>{e.detail}</Text> : null}
              </View>
            ))}
          </View>
        )}

        {(d.certifications && d.certifications.length > 0) && (
          <View wrap={false}>
            <Text style={styles.sectionT}>Certifications</Text>
            {d.certifications.map((c, ci) => (
              <View key={ci} style={styles.skillRow}>
                <Text style={styles.skillDot}>{'\u2022'}</Text>
                <Text style={styles.skills}>
                  {c.name}{c.issuer ? ` — ${c.issuer}` : ''}{c.year ? ` · ${c.year}` : ''}
                </Text>
              </View>
            ))}
          </View>
        )}
      </Page>
    </Document>
  );
}

// Render structured data -> PDF Buffer (Node runtime).
export async function renderResumePdf(d: ResumeData, preset: ResumePreset = 'classic'): Promise<Buffer> {
  const buf = await renderToBuffer(<ResumeDoc d={d} preset={preset} />);
  return Buffer.from(buf);
}

// Convert the Resume Lab's structured resume (StructuredResume) into the PDF
// renderer's ResumeData shape so the downloaded PDF matches the live editor.
export function structuredToResumeData(s: StructuredResume): ResumeData {
  const contact = [s.contact?.email, s.contact?.phone, s.contact?.location]
    .filter(Boolean)
    .join(' · ');
  return {
    name: s.contact?.name || '',
    title: s.contact?.title || '',
    contact,
    summary: s.summary ? s.summary.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [],
    experience: (s.experience || []).map((e) => ({
      role: e.role || '',
      company: e.company || '',
      dates: e.dates || '',
      location: e.location || '',
      description: e.description || '',
      technologies: e.technologies || '',
      bullets: (e.bullets || []).filter((b) => b.trim()),
    })),
    education: (s.education || []).map((e) => ({
      school: e.school || '',
      degree: e.degree || '',
      dates: e.dates || '',
      detail: e.detail || '',
    })),
    certifications: (s.certifications || []).map((c) => ({
      name: c.name || '',
      issuer: c.issuer || '',
      year: c.year || '',
    })),
    skills: (s.skills || []).filter((x) => x.trim()),
    technicalSkills: (s.technicalSkills || []).map((g) => ({ category: g.category || '', items: g.items || '' })),
  };
}