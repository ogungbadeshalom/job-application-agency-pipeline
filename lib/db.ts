// Unified data-access layer.
//
// Exports `db` — the Postgres-backed repo (db/repo.ts) that pages and API
// routes import. Call sites stay provider-agnostic; swapping storage means
// changing this one file.

import { db } from '../db/repo';

export { db };

export type { ListJobsFilter } from './types';