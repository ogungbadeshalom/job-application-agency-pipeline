// Re-render ONLY today's Kevin Thai tailored PDFs through the CURRENT pipeline.
import pg from 'pg';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { renderResumePdf, type ResumePreset } from '../lib/resume-pdf';
import { resumeTextToData } from '../lib/resume-text';

async function main() {
  const env: string = readFileSync('.env.local', 'utf8');
  const pool = new pg.Pool({ connectionString: (env.match(/DATABASE_URL=(.+)/) as string[])[1].trim().replace(/^"|"$/g, '') });

  const profRow: any = (await pool.query("select id, resume_design, email, resume_data->'contact' as c from profiles where lower(name) like '%kevin%thai%'")).rows[0];
  const preset: string = profRow.resume_design || 'classic';
  const c: any = profRow.c || {};
  const realContact: string = [profRow.email, c.phone, c.location].filter(Boolean).join(' · ');
  console.log(`profile ${profRow.id} | preset: ${preset} | contact: ${realContact}`);

  const jobs: any[] = (await pool.query(
    "select id, company, title, tailored_resume, tailored_resume_pdf_path from jobs where profile_id=$1 and tailored_resume is not null and tailored_resume_pdf_path is not null and created_at::date = current_date order by created_at desc",
    [profRow.id]
  )).rows;
  console.log(`jobs dated TODAY: ${jobs.length}`);

  const root: string = resolve(process.cwd(), process.env.STORAGE_DIR || './data/uploads');
  let ok = 0, fail = 0;
  for (let n = 0; n < jobs.length; n++) {
    const j = jobs[n];
    try {
      const data = resumeTextToData(j.tailored_resume);
      if (!data || (!data.experience.length && !data.summary.length)) throw new Error('unparseable text');
      if (realContact) data.contact = realContact;
      const buf: Buffer = await renderResumePdf(data, preset as ResumePreset);
      const full = resolve(root, j.tailored_resume_pdf_path);
      if (!full.startsWith(root)) throw new Error('bad path');
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, buf);
      ok++;
    } catch (e: any) {
      fail++;
      console.log(`FAIL ${j.id} ${j.company}: ${e.message}`);
    }
    if ((n + 1) % 10 === 0) console.log(`${n + 1}/${jobs.length} (ok=${ok} fail=${fail})`);
  }
  console.log(`REGEN COMPLETE ok=${ok} fail=${fail}`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
