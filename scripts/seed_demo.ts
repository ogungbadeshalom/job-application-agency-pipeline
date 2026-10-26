/* Seed the demo showcase: one demo client with 8 sample jobs (tailored), one
 * demo worker assigned to it, and three is_demo accounts (admin/worker/client)
 * with password 12345678. Demo users are caged read-only by middleware.ts.
 */
import { db } from '../db/repo';
import bcrypt from 'bcryptjs';
import { query } from '../db/pool';

const DEMO_EMAIL = 'demo.client@demo.pitchr';
const WORKER_EMAIL = 'demo.worker@demo.pitchr';
const ADMIN_EMAIL = 'demo.admin@demo.pitchr';
const PW = '12345678';

const FAKE_RESUME = `Kevin Demo
Senior Data Engineer | Building Reliable Data Pipelines
demo.client@demo.pitchr | Austin, TX (sample data)

SUMMARY
Senior Data Engineer with 8+ years building reliable ETL pipelines, data platforms, and analytics infrastructure. Comfortable leading small teams and partnering with stakeholders across the business.

EXPERIENCE
Lead Data Engineer - Nimbus Cloud (Jan 2021 - Present)
- Built scalable ETL pipelines on AWS orchestrated with Airflow, serving 40+ internal teams
- Consolidated legacy pipelines by 60%, cutting maintenance load and cloud spend
- Led a team of four engineers across batch and streaming workloads

Senior Data Engineer - Acme Analytics (Mar 2018 - Dec 2020)
- Designed Redshift warehouse serving BI dashboards for finance and growth teams
- Migrated on-prem Hadoop jobs to Spark on EMR, improving runtime by 3x
- Implemented data quality checks and GDPR-compliant deletion workflows

Data Engineer - Sample Systems (Jun 2015 - Feb 2018)
- Developed Kafka ingestion pipelines for event data at 50M events/day
- Built Looker dashboards and self-service query tooling for analysts

EDUCATION
B.S. Computer Science - Sample University (2011 - 2015)`;

const SAMPLE_JOBS = [
  { title: 'Senior Data Engineer', company: 'Nimbus Cloud', url: 'https://example.com/demo/nimbus-senior-de', board: 'demo', location: 'Remote — US' },
  { title: 'Analytics Engineer', company: 'Acme Analytics', url: 'https://example.com/demo/acme-analytics-eng', board: 'demo', location: 'Remote — US' },
  { title: 'Data Platform Engineer', company: 'Blue River Labs', url: 'https://example.com/demo/blueriver-platform', board: 'demo', location: 'Austin, TX (Hybrid)' },
  { title: 'Big Data Engineer', company: 'Cobalt Health', url: 'https://example.com/demo/cobalt-bigdata', board: 'demo', location: 'Remote — US' },
  { title: 'ETL Developer', company: 'Delta Retail Group', url: 'https://example.com/demo/delta-etl', board: 'demo', location: 'Remote — US' },
  { title: 'Data Warehouse Engineer', company: 'Ember Fintech', url: 'https://example.com/demo/ember-dwh', board: 'demo', location: 'New York, NY' },
  { title: 'Lead Data Engineer', company: 'Forward Logistics', url: 'https://example.com/demo/forward-lead-de', board: 'demo', location: 'Remote — US' },
  { title: 'Senior Analytics Engineer', company: 'Granite Media', url: 'https://example.com/demo/granite-analytics', board: 'demo', location: 'Remote — US' },
];

async function main() {
  // 1. users (upsert — idempotent reseed)
  const hash = bcrypt.hashSync(PW, 10);
  async function upsertUser(email: string, role: 'admin' | 'worker' | 'client', fullName: string, profileId?: string) {
    const r = await query(
      `insert into users (email, password_hash, role, full_name, profile_id, is_demo)
       values ($1,$2,$3,$4,$5,true)
       on conflict (email) do update set password_hash=$2, role=$3, full_name=$4, profile_id=$5, is_demo=true, disabled_at=null
       returning id`,
      [email, hash, role, fullName, profileId ?? null]
    );
    return r.rows[0].id as string;
  }
  const workerId = await upsertUser(WORKER_EMAIL, 'worker', 'Demo Worker');
  const adminId = await upsertUser(ADMIN_EMAIL, 'admin', 'Demo Admin');
  console.log('worker:', workerId, '| admin:', adminId);

  // 2. demo client profile
  const existing = await query(`select id from profiles where email=$1`, [DEMO_EMAIL]);
  let profileId: string;
  const resumeData = {
    contact: {
      name: 'Demo Client', email: DEMO_EMAIL, phone: '(555) 010-0199',
      title: 'Senior Data Engineer', location: 'Austin, TX',
      github: '', website: '', linkedin: '',
    },
    summary: ['Sample summary — this is demonstration data for the Pitchr showcase.'],
    education: [{ degree: 'B.S. Computer Science', school: 'Sample University', dates: '2011 - 2015' }],
    experience: [
      { company: 'Nimbus Cloud', role: 'Lead Data Engineer', dates: 'Jan 2021 - Present', bullets: ['Built scalable ETL pipelines on AWS with Airflow for 40+ teams', 'Consolidated legacy pipelines by 60%'] },
      { company: 'Acme Analytics', role: 'Senior Data Engineer', dates: 'Mar 2018 - Dec 2020', bullets: ['Designed Redshift warehouse for finance and growth BI', 'Migrated Hadoop jobs to Spark on EMR (3x faster)'] },
    ],
    technicalSkills: ['Python', 'SQL', 'Spark', 'Airflow', 'AWS', 'Redshift', 'Kafka', 'Terraform', 'dbt', 'Looker'],
  };
  const allowedRoles = ['data engineer','senior data engineer','lead data engineer','analytics engineer','data platform engineer','big data engineer','etl developer','data warehouse engineer'];
  if (existing.rowCount) {
    profileId = existing.rows[0].id as string;
    await query(
      `update profiles set name='Demo Client', assigned_worker_id=$2, resume_data=$3, allowed_roles=$4,
         auto_refill=false, require_proof=false, allow_resume_download=true, jobs_per_week=20
       where id=$1`,
      [profileId, workerId, JSON.stringify(resumeData), allowedRoles]
    );
  } else {
    const ins = await query(
      `insert into profiles (name, email, assigned_worker_id, resume_data, allowed_roles,
         auto_refill, require_proof, allow_resume_download, jobs_per_week)
       values ('Demo Client', $1, $2, $3, $4, false, false, true, 20) returning id`,
      [DEMO_EMAIL, workerId, JSON.stringify(resumeData), allowedRoles]
    );
    profileId = ins.rows[0].id as string;
  }
  console.log('demo profile:', profileId);

  // client user linked to the profile
  await upsertUser(DEMO_EMAIL, 'client', 'Demo Client', profileId);

  // worker_clients join
  await query(
    `insert into worker_clients (worker_user_id, profile_id, is_primary) values ($1,$2,true)
     on conflict (worker_user_id, profile_id) do update set is_primary=true`,
    [workerId, profileId]
  );

  // 3. sample jobs (dedupe by url)
  for (const j of SAMPLE_JOBS) {
    await query(
      `insert into jobs (profile_id, title, company, board, url, description, location, status)
       select $1,$2,$3,$4,$5,$6,$7,'saved'
       where not exists (select 1 from jobs where profile_id=$1 and url=$5)`,
      [profileId, j.title, j.company, j.board, j.url,
       'Sample job description for the Pitchr demo. This posting is fabricated for showcase purposes and exercises the full pipeline: role gates, dedupe, AI tailoring, and the apply queue. The role involves building ETL pipelines, data platforms, and analytics infrastructure using Python, SQL, Spark, Airflow, AWS, Redshift, and Kafka. Candidates should have 5+ years of data engineering experience and a track record of reliable, well-governed data.',
       j.location]
    );
  }

  // 4. tailor the demo jobs (uses the real pipeline incl. variation gate)
  const tailored = await db.autoTailorSavedJobs([profileId]);
  console.log('auto-tailored:', tailored);

  const counts = await query(`select status, count(*)::int c from jobs where profile_id=$1 group by status`, [profileId]);
  console.log('demo jobs:', JSON.stringify(counts.rows));
  console.log('SEEDED OK');
  process.exit(0);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
