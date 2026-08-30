// Cleanup (Option A) for Andrew: delete on-site-location jobs from the buggy
// LinkedIn batch. On-site = location is a physical US city/region, not remote.
// Keeps: 'Remote', null-location (ambiguous, no description to judge), and
// anything explicitly remote. Uses simple string patterns (no \s to avoid
// tsx/pg escaping issues).
import pg from 'pg';
import fs from 'fs';

const url = fs.readFileSync('.env.local', 'utf8').match(/DATABASE_URL=(\S+)/)[1];
const c = new pg.Client({ connectionString: url });

async function main() {
  await c.connect();
  const pid = '022137cc-3978-4b4a-9e0a-54f3235f08d9';

  // Pattern 1: "City, ST"  (comma, space, exactly 2 uppercase letters at end)
  // Pattern 2: "City, State, United States" / "City, State, USA"
  // Both indicate a physical location. Exclude anything with 'remote'.
  const res = await c.query(
    `delete from jobs
     where profile_id = $1
       and status = 'saved'
       and board = 'linkedin'
       and created_at > now() - interval '3 hours'
       and coalesce(location,'') <> ''
       and lower(location) not like '%remote%'
       and (
             location ~ ',\\s+[A-Z]{2}$'
          or location ~ ',\\s+[A-Za-z]+,\\s+(United States|USA|US|Canada)$'
          or lower(location) like '%on-site%'
          or lower(location) like '%on site%'
          or lower(location) like '%hybrid%'
       )`
  );

  console.log('on-site jobs deleted:', res.rowCount);

  const r = await c.query(
    `select count(*)::int saved from jobs where profile_id = $1 and status = 'saved'`,
    [pid]
  );
  console.log('remaining saved for Andrew:', r.rows[0].saved);

  const rem = await c.query(
    `select location, count(*)::int n from jobs
     where profile_id = $1 and status = 'saved'
     group by location order by n desc limit 10`,
    [pid]
  );
  console.log('top saved locations after cleanup:', JSON.stringify(rem.rows));

  await c.end();
}

main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});