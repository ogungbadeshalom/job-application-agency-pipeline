-- ApplyOS licensing + telemetry (Nigeria-first launch, per docs/pricing-tiers.md).
-- Plans: trial(3d,5) | starter(₦5k/wk,100) | pro(₦18k/mo,100) | japa(₦49k/mo,60)
-- Credits: prepaid top-ups (₦2k/10, ₦8k/45, ₦18k/100), 6-month rolling expiry.
-- The tailor meter is enforced SERVER-SIDE — local DB edits can't inflate it.

CREATE TABLE IF NOT EXISTS applyos_licenses (
  id TEXT PRIMARY KEY,                      -- key: APPLYOS-XXXXX-XXXXX-XXXXX
  email TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'trial',       -- trial | starter | pro | japa
  cycle_days INTEGER NOT NULL DEFAULT 3,    -- starter 7, monthly tiers 30, trial 3
  expires_at TIMESTAMPTZ NOT NULL,
  flw_tx_id TEXT,                           -- last verified Flutterwave transaction
  machines TEXT NOT NULL DEFAULT '[]',      -- json array of machineGuids (max 2)
  tailor_quota INTEGER NOT NULL DEFAULT 5,  -- apps per cycle; trial 5, starter 100, pro 100, japa 60
  tailor_used INTEGER NOT NULL DEFAULT 0,
  meter_reset_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '3 days',
  features TEXT NOT NULL DEFAULT '{}',      -- json: {mailbox,japaFilters,parallel}
  disabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS applyos_credits (
  id BIGSERIAL PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES applyos_licenses(id),
  apps_total INTEGER NOT NULL,
  apps_remaining INTEGER NOT NULL,
  flw_tx_id TEXT,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '6 months'
);

CREATE TABLE IF NOT EXISTS applyos_trials (
  email TEXT PRIMARY KEY,
  license_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS applyos_telemetry (
  id BIGSERIAL PRIMARY KEY,
  machine_id TEXT,
  app_version TEXT,
  applied INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  crash_stack TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applyos_licenses_email ON applyos_licenses(email);
CREATE INDEX IF NOT EXISTS idx_applyos_credits_license ON applyos_credits(license_id);
