// Apply db/schema.sql idempotently.
// Usage: npm run db:migrate
//
// Runs the whole schema as a single multi-statement script (Postgres supports
// multiple statements in one query). `if not exists` / `create or replace`
// make it safe to run repeatedly.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, 'schema.sql');
const schema = readFileSync(schemaPath, 'utf-8');

async function main() {
  const client = await pool().connect();
  try {
    console.log(`Applying ${schemaPath} ...`);
    await client.query(schema);
    console.log('✅ Schema applied.');
  } catch (err) {
    console.error('Migration failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool().end();
  }
}

main();