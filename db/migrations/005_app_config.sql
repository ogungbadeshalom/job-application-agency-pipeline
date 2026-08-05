-- App-level config. Single row (id=1) holds AI provider settings.
-- The API key is encrypted-at-rest via AES-256-GCM in lib/crypto.ts.

create table if not exists app_config (
  id                   int primary key default 1,
  ai_provider          text not null default 'custom',
  ai_model             text not null default 'claude-sonnet-5',
  ai_base_url          text,
  ai_api_key_encrypted text,
  ai_api_key_nonce     text,
  updated_at           timestamptz not null default now(),
  check (id = 1)
);

insert into app_config (id) values (1) on conflict (id) do nothing;