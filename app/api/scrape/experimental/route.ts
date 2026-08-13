import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { getSession, requireRole } from '@/lib/auth';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

// EXPERIMENTAL — scrape jobs and export them to a spreadsheet WITHOUT inserting
// into the DB. Lets the admin inspect exactly what a scrape returns before
// committing anything to a candidate's queue. May be removed later.
// Body: same config as /api/scrape ({ sites, search_terms, location,
// remote_only, results_wanted, hours_old, include_kw, exclude_kw }).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const sites = Array.isArray(body.sites) ? body.sites : [];
  const searchTerms = Array.isArray(body.search_terms) ? body.search_terms : [];
  if (!searchTerms.length) {
    return NextResponse.json({ error: 'No search terms provided.' }, { status: 400 });
  }

  const scriptPath = path.join(process.cwd(), 'scripts', 'run_jobspy.py');
  const exportPath = path.join(process.cwd(), 'scripts', 'export_jobs_xlsx.py');
  const tmpJson = path.join(os.tmpdir(), `scrape_${Date.now()}.json`);
  const tmpXlsx = path.join(os.tmpdir(), `scrape_${Date.now()}.xlsx`);

  const config = {
    sites,
    search_terms: searchTerms,
    location: body.remote_only ? 'Remote' : (body.location || 'United States'),
    remote_only: !!body.remote_only,
    // run_jobspy.py reads `is_remote` (NOT `remote_only`) for its remote filter.
    // Without this, the remote-only toggle was passed but never honored, so
    // on-site jobs leaked into the exported spreadsheet.
    is_remote: !!body.remote_only,
    job_type: body.job_type || 'full time',
    results_wanted: Number(body.results_wanted) || 50,
    hours_old: Number(body.hours_old) || 72,
    include_kw: Array.isArray(body.include_kw) ? body.include_kw : [],
    exclude_kw: Array.isArray(body.exclude_kw) ? body.exclude_kw : [],
    remove_easy_apply: body.remove_easy_apply !== false,
  };
  const configJson = JSON.stringify(config);

  const pyBin = process.platform === 'win32' ? 'python' : 'python3';

  function run(script: string, args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(pyBin, [script, ...args], { cwd: process.cwd() });
      let stderr = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`timed out after ${timeoutMs / 1000}s`)); }, timeoutMs);
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stderr); else reject(new Error(`exited ${code}: ${stderr.slice(0, 300)}`));
      });
    });
  }

  try {
    await run(scriptPath, [configJson, tmpJson], 300_000);
    await run(exportPath, [configJson, tmpJson, tmpXlsx], 60_000);
    const data = await fs.readFile(tmpXlsx);
    await fs.rm(tmpJson, { force: true });
    await fs.rm(tmpXlsx, { force: true });
    return new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="jobs-export-${Date.now()}.xlsx"`,
      },
    });
  } catch (e) {
    await fs.rm(tmpJson, { force: true }).catch(() => {});
    await fs.rm(tmpXlsx, { force: true }).catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Scrape/export failed: ${msg}` }, { status: 500 });
  }
}