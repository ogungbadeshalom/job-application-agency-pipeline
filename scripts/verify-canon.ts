import { renderResumePdf, structuredToResumeData } from '../lib/resume-pdf';
import { readFileSync, writeFileSync } from 'fs';
const s = JSON.parse(readFileSync('/tmp/kevin_canonical.json','utf8'));
const d = structuredToResumeData(s);
console.log('bullet counts:', d.experience.map(e=>e.bullets.length).join('/'));
console.log('has desc per job:', d.experience.map(e=>!!e.description).join(','));
console.log('has tech per job:', d.experience.map(e=>!!e.technologies).join(','));
renderResumePdf(d,'kevin').then(b=>{ writeFileSync('/tmp/kevin_canon.pdf',Buffer.from(b)); console.log('kevin_canon.pdf bytes', b.length); }).catch(e=>{console.error(e);process.exit(1);});
