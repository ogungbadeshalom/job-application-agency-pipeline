// Seed default accounts.
// Usage: npm run db:seed
//
// Creates (idempotently):
//   - 1 admin  (ADMIN_EMAIL / ADMIN_PASSWORD, defaults jobbidder@admin.com / changeme)
//   - 3 workers + 3 clients + profiles (demo accounts, password "changeme")
//
// The admin password comes from env (ADMIN_PASSWORD) so you can set it before
// first boot; default is "changeme" — CHANGE IT in production.

import { hash } from 'bcryptjs';
import { pool } from './pool';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@jobbidder.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

interface SeedUser {
  email: string;
  role: 'admin' | 'worker' | 'client';
  full_name: string;
  profile?: string; // for clients: the client profile name to create
}

const DEMO: SeedUser[] = [
  { email: 'admin@jobbidder.com', role: 'admin', full_name: 'Admin' },
  { email: 'worker1@jobbidder.com', role: 'worker', full_name: 'Worker 1' },
  { email: 'worker2@jobbidder.com', role: 'worker', full_name: 'Worker 2' },
  { email: 'worker3@jobbidder.com', role: 'worker', full_name: 'Worker 3' },
  { email: 'client1@acme.com', role: 'client', full_name: 'Acme Contact', profile: 'Acme Corp' },
  { email: 'client2@beta.com', role: 'client', full_name: 'Beta Contact', profile: 'Beta Inc' },
  { email: 'client3@gamma.com', role: 'client', full_name: 'Gamma Contact', profile: 'Gamma Ltd' },
];

async function main() {
  const client = await pool().connect();
  try {
    const pw = await hash(ADMIN_PASSWORD, 10);
    console.log(`Seeding accounts (admin default password set from env/demo)...`);

    for (const u of DEMO) {
      const { rows } = await client.query(
        `insert into users (email, password_hash, role, full_name)
         values ($1, $2, $3, $4)
         on conflict (email) do nothing
         returning id`,
        [u.email, pw, u.role, u.full_name]
      );
      if (rows.length === 0) continue; // already exists

      // For clients, also create a profile and link it.
      if (u.role === 'client' && u.profile) {
        const pRes = await client.query(
          `insert into profiles (name, email, scrape_search_terms, scrape_location, scrape_sites)
           values ($1, $2, $3, $4, $5) returning id`,
          [u.profile, u.email, ['engineer'], 'United States', ['indeed']]
        );
        const profileId = pRes.rows[0].id as string;
        await client.query(`update users set profile_id = $1 where email = $2`, [
          profileId,
          u.email,
        ]);
      }
    }

    // Assign workers to clients (p1->w1, p2->w2, p3->w3).
    await client.query(
      `update profiles p set assigned_worker_id = u.id
         from users u
        where u.email = 'worker1@jobbidder.com' and p.name = 'Acme Corp'`
    );
    await client.query(
      `update profiles p set assigned_worker_id = u.id
         from users u
        where u.email = 'worker2@jobbidder.com' and p.name = 'Beta Inc'`
    );
    await client.query(
      `update profiles p set assigned_worker_id = u.id
         from users u
        where u.email = 'worker3@jobbidder.com' and p.name = 'Gamma Ltd'`
    );

    console.log('✅ Seed complete.');
  } catch (err) {
    console.error('Seed failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool().end();
  }
}

main();