# Admin User Edit + AI Config + Scrape UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the admin proper edit control over existing users, move AI provider configuration into the app (encrypted-at-rest), and improve Refill Jobs UX with auto-refresh and a remote-only filter.

**Architecture:** New `users.disabled_at` for soft-disable; new `app_config` table + AES-256-GCM crypto layer for in-app AI keys; `lib/ai.ts` reads config from DB with env fallback; new `/api/config` for the admin Settings tab; admin Profiles tab gains an edit modal; Refill Jobs modal gains a Remote-only toggle and uses a soft callback to update the jobs table without a hard reload.

**Tech Stack:** Next.js 14 App Router · TypeScript · Auth.js v5 · Postgres (pg) · bcryptjs · React 18 · Tailwind (dark) · pdf-lib · pdf-parse · mammoth · NextAuth.

## Global Constraints

- Node 22, Postgres 18 (self-hosted), `pg` driver.
- Auth.js Credentials + JWT only; no magic-link, no DB RLS.
- App-level role checks via `lib/auth.ts` `requireRole()` and `getSession()`.
- All admin UI in dark mode (navy palette, Tailwind classes from existing components).
- DATABASE_URL drives `db/` — never read from process.env in routes.
- Migration files are idempotent (`if not exists`, `create or replace`).
- Mock data and Supabase deps must stay removed; only Postgres.
- AI_STUB still defaults on; the new app_config overrides the env-only path.

---

## Task 1: Disable users (schema + repo + auth gate)

**Files:**
- Create: `db/migrations/004_users_disabled.sql`
- Modify: `db/schema.sql` (add same column for fresh installs)
- Modify: `db/repo.ts` (extend `getAuthUserByEmail` to skip disabled)
- Modify: `lib/auth-config.ts` (re-check disabled_at after bcrypt compare)

**Interfaces:**
- Reads: `lib/types.ts` `User` interface gains `disabled_at: string | null`.
- Produces: `db.getAuthUserByEmail()` returns `null` if the user has `disabled_at` set.

- [ ] **Step 1: Add migration**

Write `db/migrations/004_users_disabled.sql`:

```sql
alter table users add column if not exists disabled_at timestamptz;
create index if not exists users_disabled_at_idx on users(disabled_at) where disabled_at is not null;
```

- [ ] **Step 2: Apply to live DB and verify**

Run: `npm run db:migrate`
Verify: `PGPASSWORD=jobbids psql -h localhost -p 5432 -U jobbids -d job_bidder -c "\d users"` shows `disabled_at` column.

- [ ] **Step 3: Mirror in db/schema.sql for fresh installs**

Add to the `users` table definition in `db/schema.sql`:

```sql
  disabled_at     timestamptz,
```

Right after `profile_id` and before `created_at`.

- [ ] **Step 4: Update `lib/types.ts` `User` interface**

Add `disabled_at: string | null` after `profile_id` and update `mapUser()` in `db/repo.ts` to read it.

```ts
disabled_at: (r.disabled_at as Date)?.toISOString() ?? null,
```

- [ ] **Step 5: Block disabled users in Auth.js authorize()**

In `lib/auth-config.ts`, after the bcrypt compare succeeds, check:

```ts
if (row.disabled_at) return null;
```

- [ ] **Step 6: Commit**

```bash
git add db/migrations/004_users_disabled.sql db/schema.sql db/repo.ts lib/types.ts lib/auth-config.ts
git commit -m "feat: add users.disabled_at + block disabled users from login"
```

---

## Task 2: User CRUD extensions (email, full_name, disabled_at)

**Files:**
- Modify: `db/repo.ts` (extend `updateUser()` allowed fields + new `disableUser()`/`enableUser()`)
- Modify: `app/api/users/route.ts` (extend PATCH; new POST `/api/users/[id]/disable`)
- Modify: `app/api/users/[id]/route.ts` (split-disable/enable endpoint here instead)

**Decision:** Move disable to its own endpoint to keep PATCH small. Create `app/api/users/[id]/route.ts` with `POST { action: "disable" | "enable" }`.

**Interfaces:**
- Produces: `POST /api/users/[id]` accepts `{action: "disable"}` or `{action: "enable"}`.

- [ ] **Step 1: Add repo methods**

In `db/repo.ts`, add to the exported `db` object:

```ts
async disableUser(id: string): Promise<User | null> {
  const row = await one(
    `update users set disabled_at = now() where id = $1 returning *`, [id]
  );
  return row ? mapUser(row) : null;
},
async enableUser(id: string): Promise<User | null> {
  const row = await one(
    `update users set disabled_at = null where id = $1 returning *`, [id]
  );
  return row ? mapUser(row) : null;
},
```

- [ ] **Step 2: Extend `updateUser()` allow-list**

In `db/repo.ts`, change the `patch` type signature to:

```ts
patch: { password_hash?: string; full_name?: string; email?: string }
```

And add the `email` field to the SET clause loop. Add email uniqueness check in the route (Step 3).

- [ ] **Step 3: Extend PATCH /api/users to allow email + full_name**

In `app/api/users/route.ts` PATCH handler, expand `body`:

```ts
const body = (await req.json().catch(() => ({}))) as {
  id?: string;
  password?: string;
  full_name?: string;
  email?: string;
};
```

After the existing checks, if `body.email` is changing, verify uniqueness with `db.getUserByEmail(body.email)` and 409 if taken by another user.

- [ ] **Step 4: Create `app/api/users/[id]/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { action } = await req.json().catch(() => ({} as { action?: string }));
  if (action !== 'disable' && action !== 'enable') {
    return NextResponse.json({ error: 'action must be disable or enable' }, { status: 400 });
  }
  const user = action === 'disable'
    ? await db.disableUser(params.id)
    : await db.enableUser(params.id);
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ user });
}
```

- [ ] **Step 5: Commit**

```bash
git add db/repo.ts app/api/users/route.ts app/api/users/[id]/route.ts
git commit -m "feat: extend user PATCH (email/name) + disable/enable endpoint"
```

---

## Task 3: Split DashboardClient into per-tab files

**Files:**
- Create: `app/admin/dashboard/tabs/ProfilesTab.tsx`
- Create: `app/admin/dashboard/tabs/ResumesTab.tsx`
- Create: `app/admin/dashboard/tabs/SettingsTab.tsx`
- Modify: `app/admin/dashboard/DashboardClient.tsx` (becomes thin shell)
- Create: `app/admin/dashboard/tabs/EditUserModal.tsx` (skeleton, fleshed out in Task 4)
- Create: `app/admin/dashboard/hooks/useJobs.ts`

**Interfaces:**
- Produces: `useJobs(initial)` returns `{jobs, refresh}`. Refresh fetches `/api/jobs` and updates state.

- [ ] **Step 1: Create `hooks/useJobs.ts`**

```ts
'use client';
import { useState, useCallback } from 'react';
import type { Job } from '@/lib/types';

export function useJobs(initial: Job[]) {
  const [jobs, setJobs] = useState<Job[]>(initial);
  const refresh = useCallback(async () => {
    const res = await fetch('/api/jobs');
    const data = await res.json();
    setJobs(data.jobs ?? []);
  }, []);
  return { jobs, setJobs, refresh };
}
```

- [ ] **Step 2: Create `tabs/EditUserModal.tsx` skeleton**

Skeleton with props `{user, onClose}` and form state for `email`, `full_name`, plus a "Disable" / "Enable" toggle and a "Reset password" reveal. Modal uses the existing `Modal` component. Submit PATCHes to `/api/users`. Disable/Enable POSTs to `/api/users/{id}`. This file will be filled in Task 4.

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/Modal';
import { Spinner } from '@/components/Icon';
import type { User } from '@/lib/types';

export default function EditUserModal({ user, onClose }: { user: User; onClose: () => void }) {
  // Filled in Task 4
  return <Modal open onClose={onClose} title={`Edit ${user.email}`}><div className="text-navy-500">Pending Task 4</div></Modal>;
}
```

- [ ] **Step 3: Create `tabs/ProfilesTab.tsx`**

Move the existing `ProfilesTab`, `AddWorkerModal`, `AddClientModal` from `DashboardClient.tsx` into this file. Replace the "row" rendering with a button that opens `EditUserModal` on click. Add the row → edit wiring but leave `EditUserModal` as a thin shell for now.

- [ ] **Step 4: Create `tabs/ResumesTab.tsx` and `tabs/SettingsTab.tsx`**

Move existing `ResumesTab`, `SettingsTab`, and their sub-components (`UploadModal`, `ScrapeStatus`, `LabeledInput`) verbatim. No behavior change yet.

- [ ] **Step 5: Rewrite `DashboardClient.tsx`**

Replace with a thin shell that renders the three tab components. Pass props through. Use `useJobs(initialJobs)` and pass `jobs`, `setJobs`, `refresh` to `RefillJobsModal` via an `onDone={() => refresh()}` callback. Use `refresh` from `router` for the post-modal update.

```tsx
const { jobs, refresh } = useJobs(initialJobs);
// ...
<RefillJobsModal onDone={refresh} />
```

- [ ] **Step 6: Verify build + typecheck**

Run: `npx tsc --noEmit` then `npm run build`.
Expected: clean build, 17 routes (or 18 if `/api/users/[id]` was already added).

- [ ] **Step 7: Commit**

```bash
git add app/admin/dashboard/
git commit -m "refactor: split admin dashboard into per-tab files + useJobs hook"
```

---

## Task 4: Fill out EditUserModal (real edit UI)

**Files:**
- Modify: `app/admin/dashboard/tabs/EditUserModal.tsx`
- Modify: `app/admin/dashboard/tabs/ProfilesTab.tsx` (wire click)

**Interfaces:**
- Consumes: `User` (with `disabled_at`), `Modal` component, `Spinner` icon.

- [ ] **Step 1: Implement the modal form**

Form fields:
- Email (text)
- Full name (text)
- Disabled toggle button (text changes between "Disable account" and "Re-enable account")
- "Reset password" reveal: collapsible section with password input + "Set password" button

State machine: `loading` (PATCH in flight), `pwOpen`, `pwLoading`. On submit, call PATCH `/api/users` with body `{id, email, full_name}` and on success call `onSaved?.()` and `router.refresh()`.

Disable button: confirm via window.confirm() before POSTing to `/api/users/{id}` with `{action: "disable" | "enable"}`.

Reset password: when pwOpen, show a password input. Submit PATCH with `{id, password}`. After success, close the password reveal and toast "Password updated".

- [ ] **Step 2: Wire ProfilesTab to open EditUserModal on row click**

In `ProfilesTab`, replace any `<tr>` "row" click with a button that opens the modal for that user (workers + clients table).

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit && npm run build`. Expect clean.

- [ ] **Step 4: Commit**

```bash
git add app/admin/dashboard/tabs/
git commit -m "feat: admin user edit modal (email/name/disable/reset password)"
```

---

## Task 5: crypto + app_config schema

**Files:**
- Create: `lib/crypto.ts`
- Create: `db/migrations/005_app_config.sql`
- Modify: `db/schema.sql` (add `app_config` table for fresh installs)
- Modify: `lib/types.ts` (add `AppConfig` type)
- Modify: `db/repo.ts` (add `getAppConfig()` / `setAppConfig()`)

**Interfaces:**
- Produces: `lib/crypto.ts` exports `encryptSecret(plaintext) → {ciphertext, nonce}` and `decryptSecret({ciphertext, nonce}) → plaintext`. Both throw if `AUTH_SECRET` missing.
- Produces: `db.getAppConfig(): Promise<AppConfig>` returns the row with `ai_api_key` decrypted, OR returns `null` if no row.
- Produces: `db.setAppConfig(input: {provider, model, baseUrl, apiKey}): Promise<AppConfig>` upserts row id=1.

- [ ] **Step 1: Write `lib/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'crypto';

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set');
  return pbkdf2Sync(secret, 'job-bidder-app-config', 100_000, 32, 'sha256');
}

export function encryptSecret(plaintext: string): { ciphertext: string; nonce: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([enc, tag]).toString('base64'), nonce: iv.toString('base64') };
}

export function decryptSecret({ ciphertext, nonce }: { ciphertext: string; nonce: string }): string {
  const buf = Buffer.from(ciphertext, 'base64');
  const tag = buf.subarray(buf.length - 16);
  const enc = buf.subarray(0, buf.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(nonce, 'base64'));
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf-8');
}
```

- [ ] **Step 2: Add migration `005_app_config.sql`**

```sql
create table if not exists app_config (
  id                  int primary key default 1,
  ai_provider         text not null default 'custom',
  ai_model            text not null default 'claude-sonnet-5',
  ai_base_url         text,
  ai_api_key_encrypted text,
  ai_api_key_nonce    text,
  updated_at          timestamptz not null default now(),
  check (id = 1)
);
```

- [ ] **Step 3: Apply to live DB**

Run: `npm run db:migrate`. Verify with `\d app_config`.

- [ ] **Step 4: Mirror in `db/schema.sql`**

Append the same `app_config` table definition near the end of `db/schema.sql` (after `question_snippets`).

- [ ] **Step 5: Add `AppConfig` type**

In `lib/types.ts`:

```ts
export interface AppConfig {
  id: number;
  ai_provider: 'anthropic' | 'openrouter' | 'custom';
  ai_model: string;
  ai_base_url: string | null;
  ai_api_key: string | null;       // plaintext, never stored here; loaded via repo
  updated_at: string;
}
```

- [ ] **Step 6: Add repo methods**

```ts
async getAppConfig(): Promise<AppConfig | null> {
  const row = await one('select * from app_config where id = 1');
  if (!row) return null;
  const apiKey = (row.ai_api_key_encrypted && row.ai_api_key_nonce)
    ? decryptSecret({ ciphertext: row.ai_api_key_encrypted, nonce: row.ai_api_key_nonce })
    : null;
  return {
    id: row.id as number,
    ai_provider: row.ai_provider as AppConfig['ai_provider'],
    ai_model: row.ai_model as string,
    ai_base_url: (row.ai_base_url as string) ?? null,
    ai_api_key: apiKey,
    updated_at: (row.updated_at as Date).toISOString(),
  };
},
async setAppConfig(input: { provider: AppConfig['ai_provider']; model: string; baseUrl: string | null; apiKey: string | null }): Promise<AppConfig> {
  const enc = input.apiKey ? encryptSecret(input.apiKey) : null;
  const row = await one(
    `insert into app_config (id, ai_provider, ai_model, ai_base_url, ai_api_key_encrypted, ai_api_key_nonce, updated_at)
     values (1, $1, $2, $3, $4, $5, now())
     on conflict (id) do update set
       ai_provider = excluded.ai_provider,
       ai_model = excluded.ai_model,
       ai_base_url = excluded.ai_base_url,
       ai_api_key_encrypted = excluded.ai_api_key_encrypted,
       ai_api_key_nonce = excluded.ai_api_key_nonce,
       updated_at = now()
     returning *`,
    [input.provider, input.model, input.baseUrl, enc?.ciphertext ?? null, enc?.nonce ?? null]
  );
  // ... map to AppConfig (with decrypted key for in-memory return)
}
```

Add `import { encryptSecret, decryptSecret } from '../lib/crypto';` to the top of `db/repo.ts`.

- [ ] **Step 7: Commit**

```bash
git add lib/crypto.ts lib/types.ts db/migrations/005_app_config.sql db/schema.sql db/repo.ts
git commit -m "feat: AES-256-GCM crypto + app_config table for in-app AI settings"
```

---

## Task 6: Wire lib/ai.ts to read from DB

**Files:**
- Modify: `lib/ai.ts`

**Interfaces:**
- Produces: `getAIConfig()` reads `app_config` (cached per-request), falls back to env if no row.

- [ ] **Step 1: Replace env reads with DB-backed config**

In `lib/ai.ts`:

```ts
import { db } from './db';

let cachedConfig: { provider: string; model: string; baseUrl: string | null; apiKey: string | null } | null = null;

export async function getAIConfig() {
  if (cachedConfig) return cachedConfig;
  const cfg = await db.getAppConfig();
  cachedConfig = cfg ?? null;
  return cachedConfig;
}

export function clearAIConfigCache() { cachedConfig = null; }
```

- [ ] **Step 2: Update `aiProvider()` / `aiModel()` to be async**

The `callAI` signature changes to `await getAIConfig()`. Inside `callAI`:

```ts
const cfg = await getAIConfig();
const provider = cfg?.provider || process.env.AI_PROVIDER || 'anthropic';
const model = cfg?.model || process.env.AI_MODEL || 'claude-sonnet-5';
const apiKey = cfg?.apiKey || process.env.ANTHROPIC_API_KEY;
// ...
```

And `hasAnyKey()` becomes async:

```ts
export async function hasAnyKey(): Promise<boolean> {
  const cfg = await getAIConfig();
  if (!cfg) return false;
  if (!cfg.apiKey) return false;
  return cfg.apiKey.length > 10;
}
```

Update `stubEnabled()` to be async too, and gate on `hasAnyKey()`:

```ts
async function stubEnabled(): Promise<boolean> {
  if (process.env.AI_STUB === 'false') return false;
  return !(await hasAnyKey());
}
```

Update the call sites in `stubResponse()` callers — but `stubResponse()` is only called when `stubEnabled()` is true, so this stays synchronous. Actually wait: `callAI` calls `stubEnabled()` and `stubResponse()` if stub. Make sure the type is consistent.

- [ ] **Step 3: Verify build + typecheck**

Run: `npx tsc --noEmit`. Likely errors: callers of `hasAnyKey()` and `aiProvider()` / `aiModel()`. Fix as needed (only `lib/ai.ts` calls them).

- [ ] **Step 4: Commit**

```bash
git add lib/ai.ts
git commit -m "feat: lib/ai.ts reads provider/model/key from app_config"
```

---

## Task 7: /api/config endpoint (admin-only GET/PUT)

**Files:**
- Create: `app/api/config/route.ts`

- [ ] **Step 1: Implement GET**

Returns current config but masks `api_key`: `{ ai_provider, ai_model, ai_base_url, api_key: maskKey(apiKey), api_key_set: !!apiKey, updated_at }`.

`maskKey(s)` returns first 3 chars + "..." + last 4 chars, OR `""` if missing.

- [ ] **Step 2: Implement PUT**

Body: `{ provider: 'anthropic' | 'openrouter' | 'custom', model: string, baseUrl?: string, apiKey?: string }`.

- If `apiKey` is `"__KEEP__"` (or empty string from a no-change), keep existing.
- Otherwise, treat empty `apiKey` as "remove the key" (set null).
- Validate provider is one of three.
- Call `db.setAppConfig()`. Return same shape as GET.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit && npm run build`. Expect clean.

- [ ] **Step 4: Commit**

```bash
git add app/api/config/route.ts
git commit -m "feat: /api/config GET/PUT for in-app AI settings"
```

---

## Task 8: AI Configuration panel in SettingsTab

**Files:**
- Create: `app/admin/dashboard/tabs/AIConfigPanel.tsx`
- Modify: `app/admin/dashboard/tabs/SettingsTab.tsx` (render the panel at the top)

**Interfaces:**
- Consumes: `/api/config` GET + PUT.
- Uses `Spinner`, `Modal` patterns.

- [ ] **Step 1: Implement AIConfigPanel**

State: `{ provider, model, baseUrl, apiKeyInput, apiKeySet, loading, error, saving, saved, pwOpen }`.

On mount, GET `/api/config` and populate fields. Show a status pill: green "Configured" or amber "Not configured".

Form fields:
- Provider select (anthropic / openrouter / custom)
- Model text input
- Base URL text input (disabled unless provider === 'custom')
- API key input with "Show / Hide" toggle and "Use placeholder to keep existing" hint

Submit button: "Save". Disable while saving. On success show "Saved ✓" for 1.5s.

Validation: model required; baseUrl required if provider === 'custom'.

- [ ] **Step 2: Mount panel in SettingsTab**

Add at the top of SettingsTab's panel list:

```tsx
<AIConfigPanel />
```

Above the existing "Team" section.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit && npm run build`. Expect clean.

- [ ] **Step 4: Commit**

```bash
git add app/admin/dashboard/tabs/
git commit -m "feat: AI configuration panel in admin Settings tab"
```

---

## Task 9: Soft-update + Remote filter on Refill Jobs

**Files:**
- Modify: `components/RefillJobsModal.tsx`
- Modify: `app/admin/dashboard/DashboardClient.tsx` (pass callback)

**Interfaces:**
- Consumes: `useJobs.refresh()` callback.

- [ ] **Step 1: Add Remote-only toggle**

In the form, above the "Run scrape" button, add a checkbox labeled "Remote only" bound to a new `remoteOnly` state. When checked, override each target profile's `scrape_location` with `"Remote"` in the POST body (instead of the user's entered location).

Logic in `submit()`:

```ts
const remote = remoteOnly;
const perProfileLocation = remote ? 'Remote' : location;
// pass perProfileLocation to the route
```

Actually simpler: when `remoteOnly` is true, set `location: "Remote"` in the body and let the route override. Update the route to handle the `remote` flag. Let the route translate `location: "Remote"` to override per profile.

In `app/api/scrape/route.ts`, change the location override loop:

```ts
const effectiveLocation = body.location === 'Remote' ? 'Remote' : body.location;
// (existing code picks per-profile terms; also pick per-profile location based on effectiveLocation)
```

For simplicity, when `body.location === 'Remote'`, force `location: 'Remote'` for all profiles in this scrape.

- [ ] **Step 2: Soft-update on success**

After success, the modal already calls `onDone({jobs_added})`. In `DashboardClient`, change the prop wiring so `onDone={() => refresh()}` (or call `refresh()` directly inline). On success, the modal shows "23 jobs added" for 1.2s then auto-closes. During those 1.2s, the modal is in a "result" state with no further submit.

Verify the modal's `result` state in `RefillJobsModal.tsx`:

- After `setResult(...)`, do NOT close immediately.
- `setTimeout(() => onClose(), 1200)` then return.
- The modal stays open showing the result.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit && npm run build`. Expect clean.

- [ ] **Step 4: Commit**

```bash
git add components/RefillJobsModal.tsx app/admin/dashboard/DashboardClient.tsx app/api/scrape/route.ts
git commit -m "feat: remote-only filter + soft auto-update on scrape success"
```

---

## Task 10: Frontend design pass + CLAUDE.md update

**Files:**
- Modify: `.env.example` (drop AI_* since admin now configures)
- Modify: `CLAUDE.md` (add Sections 1-3 features)
- Modify: `README.md` (mirror)

- [ ] **Step 1: Frontend pass**

Open the new `ProfilesTab.tsx`, `EditUserModal.tsx`, `AIConfigPanel.tsx`, `RefillJobsModal.tsx`. Check:
- Padding/spacing consistency with existing dark panels.
- Status pills match `StatusBadge` palette (green/blue/amber/red).
- Buttons use existing `bg-brand-greenDark` / `bg-navy-800` / `bg-emerald-600/20` patterns.
- Forms label fields with `block th-uppercase mb-1`.

Fix any inconsistencies. No structural rewrites — just polish.

- [ ] **Step 2: Update .env.example**

Remove the AI_* lines (admin now configures from the UI). Keep DATABASE_URL, AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, STORAGE_DIR.

- [ ] **Step 3: Update CLAUDE.md**

Add a new section under "Architecture" describing `app_config` + crypto + admin user mgmt + soft auto-refresh + remote filter.

- [ ] **Step 4: Commit**

```bash
git add .env.example CLAUDE.md README.md app/admin/dashboard/ components/RefillJobsModal.tsx
git commit -m "docs: update CLAUDE.md + env.example; frontend polish"
```

---

## Verification (after all tasks)

- [ ] **Step 1: Run migrations**

`npm run db:migrate` — idempotent on the new tables.

- [ ] **Step 2: Typecheck + build**

`npx tsc --noEmit && npm run build` — both clean.

- [ ] **Step 3: Smoke test**

1. Login as admin.
2. Open Profiles tab → click a client row → modal opens → change email → save → row reflects new email.
3. Open Settings → AI Configuration → switch provider to `custom`, base URL `https://freeinference.org/v1`, paste key → save → status pill green.
4. Tailor a job → real Anthropic call → response renders (or stub if you don't set a key).
5. Open Refill Jobs → tick "Remote only" → run → after success modal shows "N jobs added", closes in 1.2s, and Applications table updates without a reload.
6. Disable a worker via the edit modal → that worker can no longer log in.

- [ ] **Step 4: Final commit if anything moved**

```bash
git add -A
git commit -m "chore: post-implementation verification" --allow-empty
```