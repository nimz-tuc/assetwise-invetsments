-- 001: users/wallet/package extras + investments, transactions, support, audit log.
-- __UID__ and __PKG__ are replaced by migrate.js with the real id column types.

-- If an older table with the same name but a different layout already exists (from earlier prototypes),
-- keep it safe under a *_legacy_<timestamp> name and let the new table be created fresh.
DO $$
DECLARE r RECORD; bak TEXT;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('investments','matures_at'),('transactions','public_ref'),('support_messages','sender_role'),('audit_log','action')) AS t(tbl, marker) LOOP
    IF to_regclass(r.tbl) IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = r.tbl AND column_name = r.marker) THEN
      bak := r.tbl || '_legacy_' || to_char(now(), 'YYYYMMDDHH24MISS');
      EXECUTE format('ALTER TABLE %I RENAME TO %I', r.tbl, bak);
      RAISE NOTICE 'Existing table % has an older layout; renamed to %', r.tbl, bak;
    END IF;
  END LOOP;
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS role          VARCHAR(20) NOT NULL DEFAULT 'customer';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status        VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone         VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(12);
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by   __UID__ REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE users SET referral_code = upper(substr(md5(random()::text || id::text), 1, 8)) WHERE referral_code IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_key ON users (referral_code);

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS wallets_user_currency_key ON wallets (user_id, currency);
DO $$ BEGIN
  ALTER TABLE wallets ADD CONSTRAINT wallets_balance_nonneg CHECK (balance >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE investment_packages ADD COLUMN IF NOT EXISTS category   VARCHAR(40) NOT NULL DEFAULT 'Commodities';
ALTER TABLE investment_packages ADD COLUMN IF NOT EXISTS image_key  VARCHAR(40);
ALTER TABLE investment_packages ADD COLUMN IF NOT EXISTS is_popular BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE investment_packages ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS investments (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         __UID__ NOT NULL REFERENCES users(id),
  package_id      __PKG__ NOT NULL REFERENCES investment_packages(id),
  package_name    VARCHAR(120) NOT NULL,
  image_key       VARCHAR(40),
  amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  return_rate     NUMERIC(6,2) NOT NULL,
  duration_days   INTEGER NOT NULL CHECK (duration_days > 0),
  expected_profit NUMERIC(14,2) NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','matured')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  matures_at      TIMESTAMPTZ NOT NULL,
  paid_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS investments_user_idx ON investments (user_id, status);
CREATE INDEX IF NOT EXISTS investments_due_idx  ON investments (status, matures_at);

CREATE TABLE IF NOT EXISTS transactions (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_ref    VARCHAR(24) NOT NULL UNIQUE,
  user_id       __UID__ NOT NULL REFERENCES users(id),
  type          VARCHAR(20) NOT NULL CHECK (type IN ('deposit','withdrawal','investment','payout','adjustment')),
  amount        NUMERIC(14,2) NOT NULL,            -- signed: + credit to wallet, - debit
  currency      VARCHAR(8) NOT NULL DEFAULT 'USD',
  status        VARCHAR(20) NOT NULL CHECK (status IN ('pending','completed','failed','rejected')),
  method        VARCHAR(30),                       -- paystack | usdt_trc20 | usdt_erc20 | wallet
  reference     VARCHAR(120),                      -- customer-supplied proof: tx hash
  destination   VARCHAR(200),                      -- withdrawal target (phone or wallet address)
  provider_ref  VARCHAR(120),                      -- payment-provider id (Daraja receipt etc.)
  investment_id BIGINT REFERENCES investments(id),
  note          VARCHAR(300),
  reviewed_by   __UID__ REFERENCES users(id),
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_user_idx   ON transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_review_idx ON transactions (type, status);
-- the same blockchain hash can never be credited twice
CREATE UNIQUE INDEX IF NOT EXISTS transactions_deposit_ref_key
  ON transactions (method, upper(reference))
  WHERE type = 'deposit' AND reference IS NOT NULL AND status IN ('pending','completed');

CREATE TABLE IF NOT EXISTS support_messages (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     __UID__ NOT NULL REFERENCES users(id),      -- the customer whose conversation this is
  sender_id   __UID__ NOT NULL REFERENCES users(id),
  sender_role VARCHAR(10) NOT NULL CHECK (sender_role IN ('customer','admin')),
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS support_user_idx   ON support_messages (user_id, id);
CREATE INDEX IF NOT EXISTS support_unread_idx ON support_messages (sender_role, read_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    __UID__ REFERENCES users(id),
  action      VARCHAR(60) NOT NULL,
  target_type VARCHAR(30),
  target_id   VARCHAR(60),
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
