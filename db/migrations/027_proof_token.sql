-- 027_proof_token.sql
-- Per-worker API token for the proof-capture Chrome extension.
-- Cookie auth doesn't work for a cross-origin extension (the extension runs on
-- greenhouse.com but calls pitchr.com.ng), so each worker gets a long random
-- bearer token they paste into the extension once. It authenticates the
-- /api/proof/* endpoints. Null = no token (worker must generate one in Settings).
ALTER TABLE users ADD COLUMN IF NOT EXISTS proof_token text;
CREATE UNIQUE INDEX IF NOT EXISTS users_proof_token_idx ON users(proof_token) WHERE proof_token IS NOT NULL;