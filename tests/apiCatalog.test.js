import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import request from 'supertest';
import { getDb, initDb, seedDb, resetDbForTests } from '../src/db/connection.js';

const TEST_DB = './data/test-api-catalog.db';
const TOKEN = 'dev-admin-token';

before(() => {
  resetDbForTests();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  process.env.DB_PATH = TEST_DB;
  process.env.ADMIN_TOKEN = TOKEN;
  process.env.ALLOW_TEST_ORDER_ID = '1';
  const db = getDb();
  initDb(db);
  seedDb(db);
});

after(() => {
  resetDbForTests();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM order_idempotency');
  db.exec('DELETE FROM pending_webhooks');
  db.exec('DELETE FROM webhook_events');
  db.exec('DELETE FROM orders');
  db.prepare(`
    UPDATE offers SET stock_available = 1, stock_reserved = 0
    WHERE id = 'off_race_last'
  `).run();
});

async function createTestApp() {
  const { createApp } = await import('../src/server.js');
  return createApp();
}

test('GET /api/catalog returns paginated products', async () => {
  const res = await request(await createTestApp()).get('/api/catalog');
  assert.equal(res.status, 200);
  assert.ok(res.body.serverNow);
  assert.equal(res.body.items, undefined);
  assert.equal(res.body.limit, 20);
  assert.equal(res.body.offset, 0);
  assert.ok(res.body.total > 20);
  assert.equal(res.body.products.length, 20);
  const p = res.body.products[0];
  assert.equal(typeof p.sku, 'string');
  assert.equal(typeof p.name, 'string');
  assert.equal(typeof p.type, 'string');
  assert.equal(typeof p.minPrice, 'number');
  assert.equal(typeof p.currency, 'string');
  assert.equal(typeof p.offerCount, 'number');
  assert.ok(p.offerCount >= 1);
  assert.equal(typeof p.buyOfferId, 'string');
  assert.ok(p.buyOfferId.length > 0);
  assert.equal(typeof p.buyStockAvailable, 'number');
  assert.ok(p.buyStockAvailable >= 0);
});

test('GET /api/catalog buyOfferId is cheapest in-stock', async () => {
  const res = await request(await createTestApp())
    .get('/api/catalog')
    .query({ q: 'KEY-CS2-PRIME' });
  assert.equal(res.status, 200);
  const p = res.body.products.find((x) => x.sku === 'KEY-CS2-PRIME');
  assert.ok(p);
  assert.equal(p.buyOfferId, 'off_race_last');
  assert.equal(p.buyStockAvailable, 1);
  const race = getDb().prepare('SELECT price FROM offers WHERE id = ?').get('off_race_last');
  assert.equal(p.minPrice, race.price);
});

test('POST /api/test/reset-db restores race price below Seller A', async () => {
  const app = await createTestApp();
  const productPrice = getDb()
    .prepare('SELECT price FROM products WHERE sku = ?')
    .get('KEY-CS2-PRIME').price;

  const patched = await request(app)
    .patch('/api/admin/offers/off_race_last')
    .set('X-Admin-Token', TOKEN)
    .send({ price: productPrice });
  assert.equal(patched.status, 200);

  const reset = await request(app).post('/api/test/reset-db');
  assert.equal(reset.status, 200);
  assert.equal(reset.body.ok, true);

  const res = await request(app).get('/api/catalog').query({ q: 'KEY-CS2-PRIME' });
  assert.equal(res.status, 200);
  const p = res.body.products.find((x) => x.sku === 'KEY-CS2-PRIME');
  assert.ok(p);
  assert.equal(p.buyOfferId, 'off_race_last');
  assert.equal(p.buyStockAvailable, 1);
});

test('GET /api/catalog buyOfferId skips sold-out cheaper for in-stock dearer', async () => {
  const app = await createTestApp();
  const db = getDb();
  const offers = db.prepare(`
    SELECT id, price, stock_available
    FROM offers
    WHERE product_sku = 'KEY-CS2-PRIME'
    ORDER BY price ASC, id ASC
  `).all();
  const cheapest = offers[0];
  assert.ok(cheapest);
  const dearer = offers.find((o) => o.price > cheapest.price && o.stock_available > 0);
  assert.ok(dearer);
  const samePrice = offers.filter((o) => o.price === cheapest.price);
  const orig = samePrice.map((o) => ({ id: o.id, stock: o.stock_available }));
  for (const o of samePrice) {
    db.prepare('UPDATE offers SET stock_available = 0 WHERE id = ?').run(o.id);
  }

  try {
    const res = await request(app)
      .get('/api/catalog')
      .query({ q: 'KEY-CS2-PRIME' });
    assert.equal(res.status, 200);
    const p = res.body.products.find((x) => x.sku === 'KEY-CS2-PRIME');
    assert.ok(p);
    assert.equal(p.buyOfferId, dearer.id);
    assert.notEqual(p.buyOfferId, cheapest.id);
    assert.ok(p.buyStockAvailable > 0);
  } finally {
    const restore = db.prepare('UPDATE offers SET stock_available = ? WHERE id = ?');
    for (const o of orig) restore.run(o.stock, o.id);
  }
});

test('GET /api/catalog offset pages do not overlap', async () => {
  const app = await createTestApp();
  const a = await request(app).get('/api/catalog?limit=20&offset=0');
  const b = await request(app).get('/api/catalog?limit=20&offset=20');
  const setA = new Set(a.body.products.map((p) => p.sku));
  const setB = new Set(b.body.products.map((p) => p.sku));
  for (const sku of setB) assert.equal(setA.has(sku), false);
  assert.equal(a.body.products.map((p) => p.sku).join(','),
    [...a.body.products.map((p) => p.sku)].sort().join(','));
});

test('GET /api/catalog clamps limit', async () => {
  const app = await createTestApp();
  const five = await request(app).get('/api/catalog?limit=5');
  assert.equal(five.body.products.length, 5);
  assert.equal(five.body.limit, 5);
  const zero = await request(app).get('/api/catalog?limit=0');
  assert.equal(zero.body.limit, 1);
  assert.equal(zero.body.products.length, 1);
  const huge = await request(app).get('/api/catalog?limit=999');
  assert.equal(huge.body.limit, 50);
  assert.equal(huge.body.products.length, 50);
  const bad = await request(app).get('/api/catalog?limit=abc&offset=nope');
  assert.equal(bad.body.limit, 20);
  assert.equal(bad.body.offset, 0);
});

test('GET /api/catalog/offers returns empty array for product without offers', async () => {
  const app = await createTestApp();
  getDb().prepare(`
    INSERT INTO products (sku, name, type, price, currency, image)
    VALUES ('NO-OFFERS-TEST', 'No offers product', 'key', 100, 'RUB', NULL)
  `).run();

  const res = await request(app)
    .get('/api/catalog/offers')
    .query({ sku: 'NO-OFFERS-TEST' });
  assert.equal(res.status, 200);
  assert.equal(res.body.sku, 'NO-OFFERS-TEST');
  assert.deepEqual(res.body.offers, []);
});

test('GET /api/catalog/offers returns offers sorted by price', async () => {
  const res = await request(await createTestApp())
    .get('/api/catalog/offers')
    .query({ sku: 'KEY-CS2-PRIME' });
  assert.equal(res.status, 200);
  assert.equal(res.body.sku, 'KEY-CS2-PRIME');
  assert.ok(res.body.name);
  assert.equal(res.body.type, 'key');
  assert.ok(Array.isArray(res.body.offers));
  assert.ok(res.body.offers.length >= 2);
  const prices = res.body.offers.map((o) => o.price);
  const sorted = [...prices].sort((a, b) => a - b);
  assert.deepEqual(prices, sorted);
  assert.ok(res.body.offers.every((o) => o.offerId && o.sellerName != null));
  assert.ok(res.body.offers.some((o) => o.offerId === 'off_race_last'));
});

test('GET /api/catalog/offers requires sku and 404s unknown', async () => {
  const app = await createTestApp();
  const missing = await request(app).get('/api/catalog/offers');
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, 'SKU_REQUIRED');
  const unknown = await request(app).get('/api/catalog/offers').query({ sku: 'NO-SUCH-SKU' });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, 'NOT_FOUND');
});

test('GET /api/catalog filters type q min max other', async () => {
  const app = await createTestApp();
  const all = await request(app).get('/api/catalog?limit=1');
  const gift = await request(app).get('/api/catalog?type=giftcard&limit=1');
  assert.ok(gift.body.total < all.body.total);
  assert.ok(gift.body.products.every((p) => p.type === 'giftcard'));

  const q = await request(app).get('/api/catalog?q=KEY-CS2-PRIME');
  assert.ok(q.body.products.some((p) => p.sku === 'KEY-CS2-PRIME'));
  assert.ok(q.body.total >= 1);

  const ranged = await request(app).get('/api/catalog?min=10000&max=10000');
  assert.equal(ranged.status, 200);
  assert.ok(ranged.body.products.every((p) => p.minPrice >= 10000 && p.minPrice <= 10000)
    || ranged.body.total === 0);

  const other = await request(app).get('/api/catalog?other=1&limit=50');
  const known = new Set(['topup', 'subscription', 'key', 'giftcard']);
  assert.ok(other.body.products.every((p) => !known.has(p.type)));
  const typedOther = await request(app).get('/api/catalog?type=key&other=1&limit=5');
  assert.ok(typedOther.body.products.every((p) => p.type === 'key'));
});

test('POST /api/orders sold out returns alternatives', async () => {
  const app = await createTestApp();
  const offerId = 'off_race_last';
  const first = await request(app).post('/api/orders').send({ offerId });
  assert.equal(first.status, 201);
  assert.equal(first.body.offer_id, offerId);

  const second = await request(app).post('/api/orders').send({ offerId });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'SOLD_OUT');
  assert.equal(second.body.message, 'Товар только что раскупили');
  assert.ok(Array.isArray(second.body.alternatives));
  assert.ok(second.body.alternatives.length > 0);
  assert.ok(second.body.alternatives.every((o) => o.offerId !== offerId));
  assert.ok(second.body.alternatives.every((o) => o.stockAvailable > 0));
});

test('POST /api/orders idempotent replay returns 200', async () => {
  const app = await createTestApp();
  const offerId = 'off_race_last';
  const key = 'idem-catalog-1';
  const first = await request(app).post('/api/orders').send({ offerId, idempotency_key: key });
  assert.equal(first.status, 201);

  const second = await request(app).post('/api/orders').send({ offerId, idempotency_key: key });
  assert.equal(second.status, 200);
  assert.equal(second.body.id, first.body.id);
});

test('POST /api/orders requires offerId', async () => {
  const res = await request(await createTestApp()).post('/api/orders').send({ sku: 'KEY-CS2-PRIME' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'OFFER_ID_REQUIRED');
});

test('POST /api/orders/:id/apply-promo returns HOLD_EXPIRED for expired hold', async () => {
  const app = await createTestApp();
  const createRes = await request(app).post('/api/orders').send({ offerId: 'off_race_last' });
  const orderId = createRes.body.id;
  getDb().prepare('UPDATE orders SET hold_expires_at = ? WHERE id = ?')
    .run(new Date(0).toISOString(), orderId);

  const res = await request(app).post(`/api/orders/${orderId}/apply-promo`).send({ code: 'LIMIT3' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'HOLD_EXPIRED');
});

test('GET /api/orders/:id returns serverNow and lazy expires hold', async () => {
  const app = await createTestApp();
  const createRes = await request(app).post('/api/orders').send({ offerId: 'off_race_last' });
  const orderId = createRes.body.id;
  getDb().prepare('UPDATE orders SET hold_expires_at = ? WHERE id = ?')
    .run(new Date(0).toISOString(), orderId);

  const res = await request(app).get(`/api/orders/${orderId}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.serverNow);
  assert.equal(res.body.status, 'hold_expired');
});

test('POST /api/test/set-offer-stock resets stock and reserved', async () => {
  const app = await createTestApp();
  const hold = await request(app).post('/api/orders').send({ offerId: 'off_race_last' });
  assert.equal(hold.status, 201);

  const reset = await request(app).post('/api/test/set-offer-stock').send({
    offerId: 'off_race_last',
    stockAvailable: 1,
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.stockAvailable, 1);

  const row = getDb().prepare('SELECT stock_available, stock_reserved FROM offers WHERE id = ?')
    .get('off_race_last');
  assert.equal(row.stock_available, 1);
  assert.equal(row.stock_reserved, 0);
});

test('PATCH /api/admin/offers/:id updates price and stock', async () => {
  const res = await request(await createTestApp())
    .patch('/api/admin/offers/off_race_last')
    .set('X-Admin-Token', TOKEN)
    .send({ price: 1500, stockAvailable: 7 });

  assert.equal(res.status, 200);
  assert.equal(res.body.offerId, 'off_race_last');
  assert.equal(res.body.price, 1500);
  assert.equal(res.body.stockAvailable, 7);

  const row = getDb().prepare('SELECT price, stock_available FROM offers WHERE id = ?')
    .get('off_race_last');
  assert.equal(row.price, 1500);
  assert.equal(row.stock_available, 7);
});
