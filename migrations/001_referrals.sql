CREATE TABLE IF NOT EXISTS participants (
 id uuid PRIMARY KEY, email text UNIQUE NOT NULL, identity_hash text UNIQUE NOT NULL,
 code text UNIQUE NOT NULL, referrer uuid REFERENCES participants(id),
 confirmed boolean NOT NULL DEFAULT false, approved boolean NOT NULL DEFAULT false,
 blocked boolean NOT NULL DEFAULT false, redeemed boolean NOT NULL DEFAULT false,
 deleted boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tokens (hash text PRIMARY KEY, participant uuid REFERENCES participants(id), expires_at timestamptz NOT NULL, used boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS sessions (hash text PRIMARY KEY, participant uuid REFERENCES participants(id), expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS coupons (code text PRIMARY KEY, participant uuid UNIQUE REFERENCES participants(id), percent integer NOT NULL CHECK(percent IN (10,20,30)), expires_at timestamptz NOT NULL, used boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS orders (id uuid PRIMARY KEY, participant uuid REFERENCES participants(id), coupon text REFERENCES coupons(code), snapshot jsonb NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','cancelled','expired')), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_coupon ON orders(coupon) WHERE status='pending';
CREATE TABLE IF NOT EXISTS audit (id bigserial PRIMARY KEY, actor text NOT NULL, event text NOT NULL, target text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS limits (key text PRIMARY KEY, hits integer NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS deletion_requests (participant uuid PRIMARY KEY REFERENCES participants(id), created_at timestamptz NOT NULL DEFAULT now(), completed boolean NOT NULL DEFAULT false);
