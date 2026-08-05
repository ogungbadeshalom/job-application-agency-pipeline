// Apply db/schema.sql (idempotent DDL) then every db/migrations/*.sql in sorted
// order. Usage: npm run db:migrate
//
// Each file runs as a single multi-statement script (Postgres supports that).
// `if not exists` / `create or replace` make it safe to run repeatedly.

import { readFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, 'migrations');

const schemaPath = join(__dirname, 'schema.sql');
const files = [schemaPath];

if (existsSync(migrationsDir)) {
  readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .forEach((f) => files.push(join(migrationsDir, f)));
}

async function main() {
  const client = await pool().connect();
  try {
    for (const p of files) {
      console.log(`Applying ${p} ...`);
      await client.query(readFileSync(p, 'utf-8'));
    }
    console.log('✅ Schema + migrations applied.');
  } catch (err) {
    console.error('Migration failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool().end();
  }
}

main();