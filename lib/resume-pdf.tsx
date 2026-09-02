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
  renderToBuffer,
} from '@react-pdf/renderer';

import type { ResumePreset, StructuredResume } from './resume-presets';
export type { ResumePreset } from './resume-presets';
export { RESUME_PRESETS, isResumePreset } from './resume-presets';

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
    bullets: string[];
  }[];
  skills: string[];
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

function ResumeDoc({ d, preset }: { d: ResumeData; preset: ResumePreset }) {
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

        <Text style={styles.sectionT}>Experience</Text>
        {(d.experience || []).map((e, ei) => (
          <View key={ei} style={styles.expBlock}>
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

        <Text style={styles.sectionT}>Skills</Text>
        {(d.skills || []).map((s, i) => (
          <View key={i} style={styles.skillRow}>
            <Text style={styles.skillDot}>{'\u2022'}</Text>
            <Text style={styles.skills}>{s}</Text>
          </View>
        ))}
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
      bullets: (e.bullets || []).filter((b) => b.trim()),
    })),
    skills: (s.skills || []).filter((x) => x.trim()),
  };
}