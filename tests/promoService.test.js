import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { getDb, initDb, seedDb, resetDbForTests } from '../src/db/connection.js';
import { createOrder } from '../src/services/orderService.js';
import { applyPromoToOrder, calcDiscount, getPromoUsedCount, validatePromo } from '../src/services/promoService.js';

const TEST_DB = './data/test-promo.db';

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

test('calcDiscount percent', () => {
  assert.equal(calcDiscount({ type: 'percent', value: 10 }, 1000), 100);
});

test('validatePromo LIMIT3', () => {
  const r = validatePromo('LIMIT3', 'KEY-CS2-PRIME');
  assert.equal(r.valid, true);
  assert.equal(r.discount, 322);
});

test('applyPromoToOrder increments used_count', () => {
  const order = createOrder({ offerId: pickOfferId() });
  const r = applyPromoToOrder(order.id, 'LIMIT3');
  assert.equal(r.ok, true);
  assert.equal(getPromoUsedCount('LIMIT3'), 1);
});
