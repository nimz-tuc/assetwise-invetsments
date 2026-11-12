-- 002: investment packages with 5 / 10 / 20 day terms (percent rates; amounts in the platform currency).
-- Runs once. After this, edit packages from the Admin > Packages screen.
CREATE UNIQUE INDEX IF NOT EXISTS investment_packages_name_key ON investment_packages (name);

INSERT INTO investment_packages
  (name, description, minimum_amount, maximum_amount, duration_days, projected_return_rate, is_active, category, image_key, is_popular, sort_order)
VALUES
  ('Gold Package',      'Asset-backed gold exposure.',        500,  50000,  5, 12, TRUE, 'Commodities', 'gold',   TRUE,  1),
  ('Silver Package',    'Asset-backed silver exposure.',      300,  30000, 10, 10, TRUE, 'Commodities', 'silver', FALSE, 2),
  ('Oil & Commodities', 'Energy and commodities portfolio.', 1000, 100000, 20, 14, TRUE, 'Commodities', 'oil',    FALSE, 3),
  ('Equity Portfolio',  'Diversified equities portfolio.',   1000, 100000, 20, 15, TRUE, 'Equities',    'equity', FALSE, 4)
ON CONFLICT (name) DO UPDATE SET
  duration_days = EXCLUDED.duration_days,
  image_key     = EXCLUDED.image_key,
  is_popular    = EXCLUDED.is_popular,
  sort_order    = EXCLUDED.sort_order,
  category      = EXCLUDED.category;
