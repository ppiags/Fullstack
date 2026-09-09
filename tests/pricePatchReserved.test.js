import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { getDb, initDb, seedDb, resetDbForTests } from '../src/db/connection.js';
import { createOrder, getOrder, transitionOrder } from '../src/services/orderService.js';
import { patchOffer } from '../src/services/offerService.js';
import { applyPromoToOrder } from '../src/services/promoService.js';

const TEST_DB = './data/test-price-patch-reserved.db';

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

test('patchOffer price updates amount and final_amount on reserved order', () => {
  const offerId = 'off_race_last';
  const order = createOrder({ offerId });
  assert.equal(order.amount, order.final_amount);

  patchOffer(offerId, { price: 1500 });

  const updated = getOrder(order.id);
  assert.equal(updated.status, 'reserved');
  assert.equal(updated.amount, 1500);
  assert.equal(updated.final_amount, 1500);
});

test('patchOffer price recalculates promo discount on reserved order', () => {
  const offerId = 'off_race_last';
  const order = createOrder({ offerId });
  const promo = applyPromoToOrder(order.id, 'LIMIT3');
  assert.equal(promo.ok, true);
  assert.ok(promo.order.discount_amount > 0);

  patchOffer(offerId, { price: 2000 });

  const updated = getOrder(order.id);
  assert.equal(updated.amount, 2000);
  assert.equal(updated.discount_amount, 500);
  assert.equal(updated.final_amount, 1500);
  assert.equal(updated.promo_code, 'LIMIT3');
});

test('patchOffer price does not change paid orders', () => {
  const offerId = 'off_race_last';
  const order = createOrder({ offerId });
  const originalAmount = order.amount;
  transitionOrder(order.id, 'reserved', 'paid');

  patchOffer(offerId, { price: 9999 });

  const updated = getOrder(order.id);
  assert.equal(updated.status, 'paid');
  assert.equal(updated.amount, originalAmount);
  assert.equal(updated.final_amount, originalAmount);
});
