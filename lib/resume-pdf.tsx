// Server-side PDF rendering for tailored resumes, using @react-pdf/renderer.
// Takes structured resume data (the shape the AI returns) and produces a clean
// A4 PDF binary, matching the styling used for the standalone resume.
import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from '@react-pdf/renderer';

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

const styles = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 36, paddingLeft: 40, paddingRight: 40, fontFamily: 'Helvetica', fontSize: 10, lineHeight: 1.4 },
  header: { textAlign: 'center', marginBottom: 16 },
  name: { fontSize: 24, textAlign: 'center', fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  title: { fontSize: 13, textAlign: 'center', color: '#2a5f8f', marginBottom: 5, fontFamily: 'Helvetica-Bold' },
  contact: { fontSize: 9, textAlign: 'center', color: '#444', marginBottom: 0 },
  headerRule: { borderBottomWidth: 1.5, borderBottomColor: '#2a5f8f', marginTop: 14, marginBottom: 14 },
  sectionT: {
    fontSize: 11, color: '#2a5f8f', fontWeight: 'bold',
    borderBottomWidth: 1, borderBottomColor: '#cbd5e1',
    marginBottom: 7, paddingBottom: 3, marginTop: 12,
  },
  summary: { fontSize: 10, marginBottom: 7, textAlign: 'left', lineHeight: 1.4 },
  expBlock: { marginBottom: 12 },
  roleRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1 },
  roleText: { fontSize: 11, fontWeight: 'bold' },
  company: { fontSize: 10, color: '#333', fontStyle: 'italic', fontWeight: 'bold' },
  dates: { fontSize: 9, color: '#666' },
  bullet: { flexDirection: 'row', marginBottom: 3, paddingLeft: 11 },
  bulletDot: { width: 8, fontSize: 10, marginLeft: -11 },
  bulletText: { flex: 1, fontSize: 9.6, textAlign: 'justify' },
  skillRow: { flexDirection: 'row', marginBottom: 3, paddingLeft: 11 },
  skillDot: { width: 8, fontSize: 10, marginLeft: -11 },
  skills: { flex: 1, fontSize: 9.6 },
});

function ResumeDoc({ d }: { d: ResumeData }) {
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
export async function renderResumePdf(d: ResumeData): Promise<Buffer> {
  const buf = await renderToBuffer(<ResumeDoc d={d} />);
  return Buffer.from(buf);
}