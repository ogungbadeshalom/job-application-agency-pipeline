import { renderResumePdf, structuredToResumeData } from '../lib/resume-pdf';
import type { StructuredResume } from '../lib/resume-presets';
import { readFileSync, writeFileSync } from 'fs';

const s = JSON.parse(readFileSync('/tmp/kevin_resume.json', 'utf-8')) as StructuredResume;
const data = structuredToResumeData(s);

console.log('all bullet counts line:', data.experience.map((e) => e.bullets.length).join('/'));
console.log('skill groups:', (data.technicalSkills || []).length);

renderResumePdf(data, 'kevin').then((buf) => {
  writeFileSync('/tmp/kevin_rl_final.pdf', Buffer.from(buf));
  console.log('bytes:', buf.length);
}).catch((e) => { console.error('ERR', e); process.exit(1); });