// Postgres connection pool (node-postgres).
// Single source of truth for the DATABASE_URL connection.
//
// In Next.js App Router, modules can be bundled separately per compile unit, so
// a module-level `new Pool()` can multiply. We guard with a global singleton so
// API routes and pages always share ONE pool (critical for connection limits).

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Pool, type PoolConfig, type QueryResultRow, type QueryResult } from 'pg';

// Load .env.local so this file works standalone via `tsx db/migrate.ts` too
// (Next.js injects env in the app, but tsx doesn't).
function loadEnvLocal() {
  if (process.env.DATABASE_URL) return; // already set by Next or shell
  try {
    const p = resolve(process.cwd(), '.env.local');
    const lines = readFileSync(p, 'utf-8').split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    /* no .env.local — rely on shell env */
  }
}
loadEnvLocal();

const globalForPg = globalThis as unknown as { __jbPool?: Pool };

function makePool(): Pool {
  const cfg: PoolConfig = { connectionString: process.env.DATABASE_URL };
  const pool = new Pool(cfg);
  pool.on('error', (err) => {
    // Idle client errors shouldn't crash the process.
    console.error('Postgres pool error:', err.message);
  });
  return pool;
}

export function pool(): Pool {
  if (!globalForPg.__jbPool) globalForPg.__jbPool = makePool();
  return globalForPg.__jbPool;
}

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return pool().query<T>(text, params);
}

// Convenience: fetch one row or null.
export async function one<T extends Record<string, unknown> = any>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const res = await query<T>(text, params);
  return (res.rows[0] ?? null) as T | null;
}

// Convenience: fetch all rows.
export async function all<T extends Record<string, unknown> = any>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const res = await query<T>(text, params);
  return res.rows as T[];
}

// Health check — used by /api/health and setup scripts.
export async function ping(): Promise<boolean> {
  try {
    await query('select 1');
    return true;
  } catch {
    return false;
  }
}