-- Base tables. These already exist in your GOLDVAULT database, so this is a no-op there.
-- On a brand-new database it creates them so the migrations below can run.
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name     VARCHAR(120) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone         VARCHAR(30),
  role          VARCHAR(20) NOT NULL DEFAULT 'customer',
  status        VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallets (
  id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id  BIGINT NOT NULL REFERENCES users(id),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  balance  NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS investment_packages (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                  VARCHAR(120) NOT NULL,
  description           TEXT,
  minimum_amount        NUMERIC(14,2) NOT NULL,
  maximum_amount        NUMERIC(14,2),
  duration_days         INTEGER NOT NULL,
  projected_return_rate NUMERIC(6,2) NOT NULL,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE
);
