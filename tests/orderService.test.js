import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { getDb, initDb, seedDb, resetDbForTests } from '../src/db/connection.js';
import {
  createOrder,
  ensureHoldActive,
  expireDueHolds,
  getOrder,
  transitionOrder,
  listOrdersByStatus,
  listAllOrders,
} from '../src/services/orderService.js';
import { getOffer } from '../src/services/offerService.js';

const TEST_DB = './data/test-order.db';

beforeEach(() => {
  resetDbForTests();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  process.env.DB_PATH = TEST_DB;
  const db = getDb();
  initDb(db);
  seedDb(db);
});

afterEach(() => {
  resetDbForTests();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

function pickOfferId(minStock = 1) {
  const row = getDb().prepare(`
    SELECT id
    FROM offers
    WHERE product_sku = 'KEY-CS2-PRIME' AND stock_available >= ?
    ORDER BY stock_available DESC, id ASC
    LIMIT 1
  `).get(minStock);
  assert.ok(row?.id, `offer with stock >= ${minStock} not found`);
  return row.id;
}

test('createOrder reserves offer and sets hold_expires_at', () => {
  const offerId = 'off_race_last';
  const before = getOffer(offerId);
  const order = createOrder({ offerId });
  const after = getOffer(offerId);

  assert.equal(order.status, 'reserved');
  assert.equal(order.offer_id, offerId);
  assert.equal(order.sku, 'KEY-CS2-PRIME');
  assert.ok(order.hold_expires_at);
  assert.ok(Date.parse(order.hold_expires_at) > Date.now());
  assert.equal(after.stock_available, before.stock_available - 1);
  assert.equal(after.stock_reserved, before.stock_reserved + 1);
});

test('transition reserved to paid', () => {
  const order = createOrder({ offerId: pickOfferId() });
  const r = transitionOrder(order.id, 'reserved', 'paid');
  assert.equal(r.changed, true);
  assert.equal(getOrder(order.id).status, 'paid');
});

test('final state cannot transition', () => {
  const order = createOrder({ offerId: pickOfferId() });
  transitionOrder(order.id, 'reserved', 'payment_failed');
  const r = transitionOrder(order.id, 'payment_failed', 'paid');
  assert.equal(r.changed, false);
});

test('createOrder idempotency returns same order', () => {
  const offerId = pickOfferId();
  const a = createOrder({ offerId, idempotencyKey: 'test-key-1' });
  const b = createOrder({ offerId, idempotencyKey: 'test-key-1' });
  assert.equal(a.id, b.id);
});

test('listAllOrders returns all orders sorted by created_at desc', () => {
  const a = createOrder({ offerId: pickOfferId() });
  transitionOrder(a.id, 'reserved', 'paid');
  const b = createOrder({ offerId: pickOfferId() });
  const all = listAllOrders();
  assert.equal(all.length, 2);
  assert.ok(all[0].created_at >= all[1].created_at);
});

test('listOrdersByStatus filters single status', () => {
  const a = createOrder({ offerId: pickOfferId() });
  transitionOrder(a.id, 'reserved', 'paid');
  createOrder({ offerId: pickOfferId() });
  const paid = listOrdersByStatus(['paid']);
  assert.equal(paid.length, 1);
  assert.equal(paid[0].id, a.id);
});

test('expireDueHolds expires due reserved order and restores stock', () => {
  const offerId = 'off_race_last';
  const before = getOffer(offerId);
  const order = createOrder({ offerId });
  getDb().prepare(`UPDATE orders SET hold_expires_at = ? WHERE id = ?`)
    .run(new Date(0).toISOString(), order.id);

  const expired = expireDueHolds();
  const refreshedOrder = getOrder(order.id);
  const after = getOffer(offerId);

  assert.equal(expired, 1);
  assert.equal(refreshedOrder.status, 'hold_expired');
  assert.equal(after.stock_available, before.stock_available);
  assert.equal(after.stock_reserved, before.stock_reserved);
});

test('ensureHoldActive lazily expires outdated reserved order', () => {
  const offerId = 'off_race_last';
  const order = createOrder({ offerId });
  getDb().prepare(`UPDATE orders SET hold_expires_at = ? WHERE id = ?`)
    .run(new Date(0).toISOString(), order.id);

  const checked = ensureHoldActive(order.id);
  const offer = getOffer(offerId);

  assert.equal(checked.status, 'hold_expired');
  assert.equal(offer.stock_available, 1);
  assert.equal(offer.stock_reserved, 0);
});
