-- Asset Agent v0.7 Cloudflare D1 cloud sync foundation.
-- Apply with Wrangler after creating the D1 database and binding it to Pages.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('cash', 'stock', 'etf', 'fund', 'loan', 'other')),
  name TEXT,
  ticker TEXT,
  currency TEXT NOT NULL DEFAULT 'TWD',
  amount REAL,
  amount_value REAL,
  shares REAL,
  buy_price REAL,
  market_price REAL,
  market_price_updated_at TEXT,
  buy_date TEXT,
  principal REAL,
  years REAL,
  annual_rate REAL,
  start_date TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_assets_user_updated_at ON assets (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_user_type_currency ON assets (user_id, type, currency);
CREATE INDEX IF NOT EXISTS idx_assets_user_ticker_currency ON assets (user_id, ticker, currency);
CREATE INDEX IF NOT EXISTS idx_assets_user_deleted_at ON assets (user_id, deleted_at);

CREATE TABLE IF NOT EXISTS exchange_rates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'TWD',
  provider TEXT,
  provider_url TEXT,
  provider_documentation_url TEXT,
  fetched_at TEXT,
  source_updated_at TEXT,
  source_next_update_at TEXT,
  rates_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_user_updated_at ON exchange_rates (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS financial_goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  goals_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS asset_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  net_worth_twd REAL NOT NULL,
  total_assets_twd REAL NOT NULL,
  total_liabilities_twd REAL NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES profiles(id),
  UNIQUE (user_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_asset_snapshots_user_date ON asset_snapshots (user_id, snapshot_date DESC);
