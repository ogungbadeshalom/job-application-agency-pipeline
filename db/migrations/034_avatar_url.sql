-- Add optional per-user avatar URL so client/worker identities can show a photo.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;