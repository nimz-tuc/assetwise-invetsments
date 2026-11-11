-- Platform currency is now USD. Existing amounts are relabelled, not converted.
ALTER TABLE wallets ALTER COLUMN currency SET DEFAULT 'USD';
ALTER TABLE transactions ALTER COLUMN currency SET DEFAULT 'USD';
UPDATE wallets w SET currency = 'USD' WHERE currency <> 'USD'
  AND NOT EXISTS (SELECT 1 FROM wallets x WHERE x.user_id = w.user_id AND x.currency = 'USD');
UPDATE transactions SET currency = 'USD' WHERE currency <> 'USD';
