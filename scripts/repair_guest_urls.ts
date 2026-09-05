/* Repair: backfill url + board on guest-run jobs that were inserted with
 * url='' and board='unknown' due to the field-name bug in the driver.
 * Source of truth: scripts/../tmp/linkedin_guest_out.json (the scrape output),
 * matched by (title, company) since urls are empty in the DB.
 * Idempotent: only touches rows where url is null/empty for Andrew's profile.
 */
import fs from 'fs';
import path from 'path';
import pg from 'pg';
const { Client } = pg;

const PROFILE_ID = '022137cc-3978-4b4a-9e0a-54f3235f08d9';
const OUT = path.join(__dirname, '..', 'tmp', 'linkedin_guest_out.json');

async function main() {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
  const match = env.match(/DATABASE_URL=(\S+)/);
  if (!match) throw new Error('DATABASE_URL not found in .env.local');
  const url = match[1];
  const c = new Client({ connectionString: url });
  await c.connect();

  const rows = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  console.log(`scrape file has ${rows.length} jobs with urls`);

  // index by title+company
  const idx = new Map();
  for (const r of rows) {
    idx.set(`${r.title}||${r.company}`.toLowerCase(), r);
  }

  const bad = await c.query(
    `select id, title, company from jobs
     where profile_id=$1 and (url is null or url='') and status='saved'`,
    [PROFILE_ID]
  );
  console.log(`broken rows to repair: ${bad.rows.length}`);

  let fixed = 0, missing = 0;
  for (const row of bad.rows) {
    const m = idx.get(`${row.title}||${row.company}`.toLowerCase());
    if (!m || !m.url) { missing++; continue; }
    await c.query(
      `update jobs set url=$1, board=$2 where id=$3`,
      [m.url, m.board || 'linkedin', row.id]
    );
    fixed++;
  }
  console.log(`repaired: ${fixed} | no-match: ${missing}`);
  await c.end();
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });