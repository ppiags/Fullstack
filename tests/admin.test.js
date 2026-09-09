import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import request from 'supertest';
import { getDb, initDb, seedDb, resetDbForTests } from '../src/db/connection.js';
import { createOrder, transitionOrder } from '../src/services/orderService.js';

const TEST_DB = './data/test-admin.db';
const TOKEN = 'dev-admin-token';

before(() => {
  resetDbForTests();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  process.env.DB_PATH = TEST_DB;
  process.env.ADMIN_TOKEN = TOKEN;
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
  db.exec('DELETE FROM orders');
});

function pickOfferId() {
  const row = getDb().prepare(`
    SELECT id
    FROM offers
    WHERE product_sku = 'KEY-CS2-PRIME' AND stock_available > 0
    ORDER BY stock_available DESC, id ASC
    LIMIT 1
  `).get();
  assert.ok(row?.id);
  return row.id;
}

test('GET /api/admin/orders returns all by default', async () => {
  createOrder({ offerId: pickOfferId() });
  const o2 = createOrder({ offerId: pickOfferId() });
  transitionOrder(o2.id, 'reserved', 'paid');
  transitionOrder(o2.id, 'paid', 'delivered', { delivery_code: 'KEY-1' });

  const { createApp } = await import('../src/server.js');
  const res = await request(createApp())
    .get('/api/admin/orders')
    .set('X-Admin-Token', TOKEN);

  assert.equal(res.status, 200);
  assert.equal(res.body.orders.length, 2);
});

test('admin UI filters reserved not created', () => {
  const html = fs.readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
  assert.match(html, /data-status="reserved"/);
  assert.match(html, /data-status="unfulfilled"/);
  assert.match(html, /data-status="paid"/);
  assert.match(html, /data-status="delivering"/);
  assert.match(html, /data-status="delivered"/);
  assert.match(html, /data-status="out_of_stock"/);
  assert.match(html, /data-status="delivery_failed"/);
  assert.match(html, /data-status="payment_failed"/);
  assert.doesNotMatch(html, /data-status="created"/);
  const js = fs.readFileSync(new URL('../public/js/admin.js', import.meta.url), 'utf8');
  assert.match(js, /Нет заказов: оплачен, не выдан/);
  assert.match(js, /paid,delivering,out_of_stock,delivery_failed/);
});

test('GET /api/admin/orders comma-status is unfulfilled set sorted DESC', async () => {
  const offerId = pickOfferId();
  const reserved = createOrder({ offerId });
  const paid = createOrder({ offerId });
  const delivering = createOrder({ offerId });
  const oos = createOrder({ offerId });
  const failed = createOrder({ offerId });
  const delivered = createOrder({ offerId });
  const payFail = createOrder({ offerId });

  transitionOrder(paid.id, 'reserved', 'paid');
  transitionOrder(delivering.id, 'reserved', 'paid');
  transitionOrder(delivering.id, 'paid', 'delivering');
  transitionOrder(oos.id, 'reserved', 'paid');
  transitionOrder(oos.id, 'paid', 'out_of_stock');
  transitionOrder(failed.id, 'reserved', 'paid');
  transitionOrder(failed.id, 'paid', 'delivery_failed');
  transitionOrder(delivered.id, 'reserved', 'paid');
  transitionOrder(delivered.id, 'paid', 'delivered', { delivery_code: 'KEY-1' });
  transitionOrder(payFail.id, 'reserved', 'payment_failed');

  getDb().prepare('UPDATE orders SET created_at = ? WHERE id = ?')
    .run('2020-01-01T00:00:00.000Z', paid.id);
  getDb().prepare('UPDATE orders SET created_at = ? WHERE id = ?')
    .run('2026-08-01T00:00:00.000Z', failed.id);
  getDb().prepare('UPDATE orders SET created_at = ? WHERE id = ?')
    .run('2026-09-01T00:00:00.000Z', delivering.id);
  getDb().prepare('UPDATE orders SET created_at = ? WHERE id = ?')
    .run('2026-12-01T00:00:00.000Z', oos.id);

  const { createApp } = await import('../src/server.js');
  const res = await request(createApp())
    .get('/api/admin/orders?status=paid,delivering,out_of_stock,delivery_failed')
    .set('X-Admin-Token', TOKEN);

  assert.equal(res.status, 200);
  const ids = res.body.orders.map((o) => o.id);
  const statuses = new Set(res.body.orders.map((o) => o.status));
  assert.equal(res.body.orders.length, 4);
  assert.deepEqual([...statuses].sort(), ['delivering', 'delivery_failed', 'out_of_stock', 'paid']);
  assert.ok(!ids.includes(reserved.id));
  assert.ok(!ids.includes(delivered.id));
  assert.ok(!ids.includes(payFail.id));
  assert.equal(ids[0], oos.id);
  assert.ok(ids.indexOf(oos.id) < ids.indexOf(paid.id));
});

test('GET /api/admin/offers lists off_race_last and requires token', async () => {
  const { createApp } = await import('../src/server.js');
  const app = createApp();

  const denied = await request(app).get('/api/admin/offers');
  assert.equal(denied.status, 401);

  const res = await request(app)
    .get('/api/admin/offers')
    .set('X-Admin-Token', TOKEN);

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.offers));
  assert.ok(res.body.offers.length >= 1);
  const race = res.body.offers.find((o) => o.offerId === 'off_race_last');
  assert.ok(race);
  assert.equal(race.productSku, 'KEY-CS2-PRIME');
  assert.equal(typeof race.price, 'number');
  assert.equal(typeof race.stockAvailable, 'number');
  assert.equal(res.body.offers[0].offerId, 'off_race_last');
});

test('admin UI has offers modal', () => {
  const html = fs.readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
  assert.match(html, /id="openOffersBtn"/);
  assert.match(html, /id="offersModal"/);
  assert.match(html, /id="offersBody"/);
});

test('admin UI has SKU helpers and draft/saved status copy', () => {
  const html = fs.readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
  assert.match(html, /id="soldOutSkuBtn"/);
  assert.match(html, /id="makeBuyOfferBtn"/);
  const js = fs.readFileSync(new URL('../public/js/admin.js', import.meta.url), 'utf8');
  assert.match(js, /Обнулить SKU/);
  assert.match(js, /Карточка купит этот/);
  assert.match(js, /formatOfferStatus/);
  assert.match(js, /Черновик/);
  assert.match(js, /Сохранено/);
  assert.match(js, /карточка: нет в наличии/);
  assert.match(js, /этот offer не buyOfferId/);
  assert.doesNotMatch(js, /Выбран /);
});

test('GET /api/admin/orders?status=delivered filters', async () => {
  createOrder({ offerId: pickOfferId() });
  const o2 = createOrder({ offerId: pickOfferId() });
  transitionOrder(o2.id, 'reserved', 'paid');
  transitionOrder(o2.id, 'paid', 'delivered', { delivery_code: 'KEY-1' });

  const { createApp } = await import('../src/server.js');
  const res = await request(createApp())
    .get('/api/admin/orders?status=delivered')
    .set('X-Admin-Token', TOKEN);

  assert.equal(res.status, 200);
  assert.equal(res.body.orders.length, 1);
  assert.equal(res.body.orders[0].status, 'delivered');
});

async function adminApp() {
  const { createApp } = await import('../src/server.js');
  return createApp();
}

function resetGen0() {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id FROM offers WHERE product_sku = 'GEN-0' ORDER BY id ASC`,
  ).all();
  assert.ok(rows.length >= 3, 'GEN-0 must have 3+ offers');
  const upd = db.prepare(
    `UPDATE offers SET price = ?, stock_available = 1, stock_reserved = 0 WHERE id = ?`,
  );
  rows.forEach((r, i) => upd.run(500 + i * 10, r.id));
}

function makeBuyPayload(view, offerId) {
  const current = view.skuOffers.find((o) => o.offerId === offerId);
  assert.ok(current);
  const others = view.skuOffers.filter(
    (o) => o.offerId !== offerId && o.stockAvailable > 0,
  );
  const minOthers = others.length ? Math.min(...others.map((o) => o.price)) : 0;
  const price = minOthers === 0 ? 0 : minOthers - 1;
  return { price, stockAvailable: Math.max(current.stockAvailable, 1) };
}

test('GET /api/admin/offers/:id returns buy hint view', async () => {
  resetGen0();
  const app = await adminApp();
  const missing = await request(app)
    .get('/api/admin/offers/nope')
    .set('X-Admin-Token', TOKEN);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'OFFER_NOT_FOUND');

  const res = await request(app)
    .get('/api/admin/offers/off_GEN-0_0')
    .set('X-Admin-Token', TOKEN);
  assert.equal(res.status, 200);
  assert.equal(res.body.offerId, 'off_GEN-0_0');
  assert.equal(res.body.productSku, 'GEN-0');
  assert.equal(res.body.buyOfferId, 'off_GEN-0_0');
  assert.equal(res.body.buyPrice, 500);
  assert.ok(res.body.buyStockAvailable > 0);
  assert.ok(res.body.offerCount >= 3);
  assert.ok(res.body.inStockCount >= 3);
  assert.ok(Array.isArray(res.body.skuOffers));
  assert.equal(res.body.skuOffers[0].offerId, 'off_GEN-0_0');
});

test('PATCH off_GEN-0_0 expensive+zero stock switches buyOfferId', async () => {
  resetGen0();
  const app = await adminApp();
  const res = await request(app)
    .patch('/api/admin/offers/off_GEN-0_0')
    .set('X-Admin-Token', TOKEN)
    .send({ price: 1111111, stockAvailable: 0 });
  assert.equal(res.status, 200);
  assert.notEqual(res.body.buyOfferId, 'off_GEN-0_0');
  assert.equal(res.body.inStockCount >= 1, true);
  const neighbor = res.body.skuOffers.find((o) => o.offerId === res.body.buyOfferId);
  assert.ok(neighbor);
  assert.equal(res.body.buyPrice, neighbor.price);
  assert.ok(neighbor.stockAvailable > 0);
});

test('PATCH all GEN-0 skuOffers to 0 yields sold out card', async () => {
  resetGen0();
  const app = await adminApp();
  const first = await request(app)
    .get('/api/admin/offers/off_GEN-0_0')
    .set('X-Admin-Token', TOKEN);
  assert.equal(first.status, 200);
  for (const o of first.body.skuOffers) {
    const patch = await request(app)
      .patch(`/api/admin/offers/${o.offerId}`)
      .set('X-Admin-Token', TOKEN)
      .send({ stockAvailable: 0 });
    assert.equal(patch.status, 200);
  }
  const last = await request(app)
    .get('/api/admin/offers/off_GEN-0_0')
    .set('X-Admin-Token', TOKEN);
  assert.equal(last.body.buyStockAvailable, 0);
  assert.equal(last.body.inStockCount, 0);
});

test('make-buy formula on off_GEN-0_1 becomes buyOfferId', async () => {
  resetGen0();
  const app = await adminApp();
  const view = await request(app)
    .get('/api/admin/offers/off_GEN-0_1')
    .set('X-Admin-Token', TOKEN);
  assert.equal(view.status, 200);
  assert.notEqual(view.body.buyOfferId, 'off_GEN-0_1');
  const payload = makeBuyPayload(view.body, 'off_GEN-0_1');
  const patched = await request(app)
    .patch('/api/admin/offers/off_GEN-0_1')
    .set('X-Admin-Token', TOKEN)
    .send(payload);
  assert.equal(patched.status, 200);
  assert.equal(patched.body.buyOfferId, 'off_GEN-0_1');
  const again = await request(app)
    .get('/api/admin/offers/off_GEN-0_1')
    .set('X-Admin-Token', TOKEN);
  assert.equal(again.body.buyOfferId, 'off_GEN-0_1');
});

test('PATCH /api/admin/offers/:id rejects unsafe price and stock', async () => {
  const app = await adminApp();
  const token = { 'X-Admin-Token': TOKEN };

  const huge = await request(app)
    .patch('/api/admin/offers/off_race_last')
    .set(token)
    .send({ price: 2e21 });
  assert.equal(huge.status, 400);
  assert.equal(huge.body.error, 'INVALID_PRICE');

  const frac = await request(app)
    .patch('/api/admin/offers/off_race_last')
    .set(token)
    .send({ price: 1.5 });
  assert.equal(frac.status, 400);
  assert.equal(frac.body.error, 'INVALID_PRICE');

  const negPrice = await request(app)
    .patch('/api/admin/offers/off_race_last')
    .set(token)
    .send({ price: -1 });
  assert.equal(negPrice.status, 400);
  assert.equal(negPrice.body.error, 'INVALID_PRICE');

  const negStock = await request(app)
    .patch('/api/admin/offers/off_race_last')
    .set(token)
    .send({ stockAvailable: -1 });
  assert.equal(negStock.status, 400);
  assert.equal(negStock.body.error, 'INVALID_STOCK');

  const ok = await request(app)
    .patch('/api/admin/offers/off_race_last')
    .set(token)
    .send({ price: 1111111 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.price, 1111111);
});
