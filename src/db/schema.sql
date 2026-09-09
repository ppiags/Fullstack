CREATE TABLE IF NOT EXISTS products (
  sku TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  price INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  image TEXT
);

CREATE TABLE IF NOT EXISTS keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  order_id TEXT,
  assigned_at TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  status TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  promo_code TEXT,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  final_amount INTEGER NOT NULL,
  delivery_code TEXT,
  delivery_request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (sku) REFERENCES products(sku)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  payload_status TEXT NOT NULL,
  order_status_at_process TEXT,
  processed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_webhooks (
  event_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS promocodes (
  code TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  value INTEGER NOT NULL,
  currency TEXT,
  max_uses INTEGER NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  order_id TEXT UNIQUE NOT NULL,
  discount_amount INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (code) REFERENCES promocodes(code)
);

CREATE TABLE IF NOT EXISTS order_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_keys_status ON keys(status);

CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  product_sku TEXT NOT NULL,
  seller_name TEXT NOT NULL,
  price INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  stock_available INTEGER NOT NULL DEFAULT 0,
  stock_reserved INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (product_sku) REFERENCES products(sku)
);

CREATE INDEX IF NOT EXISTS idx_offers_sku ON offers(product_sku);
