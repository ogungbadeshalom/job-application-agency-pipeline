// Cleanup (Option A) for Andrew: purge on-site-location jobs from the queue.
// Reusable: run whenever on-site jobs sneak in. Uses the shared app DB layer
// (db/pool query) so it stays consistent with the rest of the app and avoids
// re-parsing .env.local.
//
//   npx tsx scripts/cleanup_andrew_onsite.ts
//
// Only touches 'saved' jobs for PROFILE_ID whose location is a physical US
// city/region (not remote). Keeps 'Remote' and null-location (ambiguous).
import { query } from '../db/pool';

const PROFILE_ID = '022137cc-3978-4b4a-9e0a-54f3235f08d9';

async function main() {
  // On-site = location has a physical city/state/region, no remote signal.
  // Regex uses explicit spaces (not \s) to avoid pg/tsx escaping friction.
  const res = await query(
    `delete from jobs
     where profile_id = $1
       and status = 'saved'
       and coalesce(location, '') <> ''
       and lower(location) not like '%remote%'
       and (
             location ~ ',[ ]+[A-Z]{2}$'
          or location ~ ',[ ]+[A-Za-z]+,[ ]+(United States|USA|US|Canada)$'
          or lower(location) like '%on-site%'
          or lower(location) like '%on site%'
          or lower(location) like '%hybrid%'
          or lower(location) like '%metropolitan area%'
       )`,
    [PROFILE_ID]
  );
  console.log('on-site jobs deleted:', res.rowCount);

  const r = await query<{ saved: number; remote: number }>(
    `select count(*)::int as saved,
            count(*) filter (where location = 'Remote')::int as remote
     from jobs where profile_id = $1 and status = 'saved'`,
    [PROFILE_ID]
  );
  console.log('saved now:', r.rows[0].saved, '| explicit Remote:', r.rows[0].remote);
}

main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});