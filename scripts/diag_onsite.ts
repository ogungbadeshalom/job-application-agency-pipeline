// Diagnose on-site jobs in Andrew's queue (Option A heuristic) — COUNT only.
import pg from 'pg';
import fs from 'fs';

const url = fs.readFileSync('.env.local', 'utf8').match(/DATABASE_URL=(\S+)/)[1];
const c = new pg.Client({ connectionString: url });

async function main() {
  await c.connect();
  const pid = '022137cc-3978-4b4a-9e0a-54f3235f08d9';

  // Sample distinct locations for the candidate pool first.
  const sample = await c.query(
    `select location, count(*)::int n
     from jobs
     where profile_id = $1 and status = 'saved' and board = 'linkedin'
       and created_at > now() - interval '3 hours'
     group by location
     order by n desc
     limit 40`,
    [pid]
  );
  console.log('=== candidate saved locations (linkedin, recent) ===');
  sample.rows.forEach((r) => console.log(`  ${r.n}x  ${JSON.stringify(r.location)}`));

  await c.end();
}

main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});