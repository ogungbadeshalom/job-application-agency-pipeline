// Apply db/schema.sql once, then each db/migrations/*.sql once, in sorted order,
// tracking which files have already run in a `_migrations` table. Subsequent
// `npm run db:migrate` runs only the new files. This is what makes migrations
// like enum swaps (006) safe — they run exactly once.

import { readFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join, basename } from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, 'migrations');
const schemaPath = join(__dirname, 'schema.sql');

async function main() {
  const client = await pool().connect();
  try {
    // Track applied files (safe if table doesn't exist yet).
    await client.query(`
      create table if not exists _migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    const applied = new Set(
      (await client.query('select name from _migrations')).rows.map((r) => r.name as string)
    );

    // Build ordered file list: schema.sql first, then migrations/*.sql.
    const files: { name: string; path: string }[] = [
      { name: basename(schemaPath), path: schemaPath },
    ];
    if (existsSync(migrationsDir)) {
      readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .forEach((f) => files.push({ name: f, path: join(migrationsDir, f) }));
    }

    for (const file of files) {
      if (applied.has(file.name)) {
        console.log(`skip ${file.name} (already applied)`);
        continue;
      }
      console.log(`Applying ${file.path} ...`);
      await client.query(readFileSync(file.path, 'utf-8'));
      await client.query('insert into _migrations (name) values ($1)', [file.name]);
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