-- Additive migration: preserve participants, referral attribution, coupons and orders.
ALTER TABLE participants ADD COLUMN IF NOT EXISTS google_sub_hash text;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS consent_version text;
CREATE UNIQUE INDEX IF NOT EXISTS unique_google_identity ON participants(google_sub_hash) WHERE google_sub_hash IS NOT NULL;
CREATE TABLE IF NOT EXISTS participant_contacts (
 identity_hash text PRIMARY KEY,
 participant uuid NOT NULL REFERENCES participants(id)
);
INSERT INTO participant_contacts(identity_hash,participant) SELECT identity_hash,id FROM participants ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS google_auth_challenges (
 hash text PRIMARY KEY, nonce_hash text NOT NULL, ref_code text,
 expires_at timestamptz NOT NULL, used boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS admin_bindings (
 email_hash text PRIMARY KEY, participant uuid UNIQUE NOT NULL REFERENCES participants(id),
 google_sub_hash text UNIQUE NOT NULL
);
-- Legacy email tokens/sessions must not survive the authentication migration.
-- The migration runner records this file so subsequent runs do not revoke new sessions.
UPDATE tokens SET expires_at=LEAST(expires_at,now());
UPDATE sessions SET expires_at=LEAST(expires_at,now());
