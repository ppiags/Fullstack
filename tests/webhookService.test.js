import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { getDb, initDb, seedDb, resetDbForTests } from '../src/db/connection.js';
import { createOrder, getOrder } from '../src/services/orderService.js';
import { processPaymentWebhook, countWebhookEvents, applyPendingWebhooksForOrder } from '../src/services/webhookService.js';
import { resetSupplierMocks } from '../src/mocks/supplierMocks.js';
import { getOffer } from '../src/services/offerService.js';

const TEST_DB = './data/test-webhook.db';

beforeEach(() => {
  resetDbForTests();
  resetSupplierMocks();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  process.env.DB_PATH = TEST_DB;
  process.env.SUPPLIER_A_ERROR_RATE = '0';
  process.env.SUPPLIER_B_ERROR_RATE = '0';
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

test('duplicate event_id is no-op', async () => {
  const order = createOrder({ offerId: pickOfferId() });
  const payload = {
    event_id: 'evt_dup',
    order_id: order.id,
    status: 'paid',
    amount: 1290,
    currency: 'RUB',
    created_at: new Date().toISOString(),
  };
  await processPaymentWebhook(payload);
  const status1 = getOrder(order.id).status;
  const r2 = await processPaymentWebhook(payload);
  assert.equal(r2.duplicate, true);
  assert.equal(getOrder(order.id).status, status1);
  assert.equal(countWebhookEvents('evt_dup'), 1);
});

test('webhook before order stored as pending', async () => {
  const payload = {
    event_id: 'evt_early',
    order_id: 'ord_future123',
    status: 'paid',
    amount: 1290,
    currency: 'RUB',
    created_at: new Date().toISOString(),
  };
  await processPaymentWebhook(payload);
  const pending = getDb().prepare('SELECT COUNT(*) AS c FROM pending_webhooks').get().c;
  assert.equal(pending, 1);
});

test('paid webhook consumes reserved exactly once', async () => {
  const offerId = 'off_race_last';
  const order = createOrder({ offerId });
  const afterReserve = getOffer(offerId);
  assert.equal(afterReserve.stock_available, 0);
  assert.equal(afterReserve.stock_reserved, 1);

  await processPaymentWebhook({
    event_id: 'evt_paid_1',
    order_id: order.id,
    status: 'paid',
    amount: order.final_amount,
    currency: order.currency,
    created_at: new Date().toISOString(),
  });

  const afterFirstPaid = getOffer(offerId);
  assert.equal(afterFirstPaid.stock_available, 0);
  assert.equal(afterFirstPaid.stock_reserved, 0);

  await processPaymentWebhook({
    event_id: 'evt_paid_2',
    order_id: order.id,
    status: 'paid',
    amount: order.final_amount,
    currency: order.currency,
    created_at: new Date().toISOString(),
  });

  const afterSecondPaid = getOffer(offerId);
  assert.equal(afterSecondPaid.stock_available, 0);
  assert.equal(afterSecondPaid.stock_reserved, 0);
});

test('paid webhook returns needsDeliver without waiting for key', async () => {
  const order = createOrder({ offerId: pickOfferId() });
  const result = await processPaymentWebhook({
    event_id: 'evt_fast_200',
    order_id: order.id,
    status: 'paid',
    amount: order.final_amount,
    currency: order.currency,
    created_at: new Date().toISOString(),
  });
  assert.equal(result.needsDeliver, true);
  const after = getOrder(order.id);
  assert.equal(after.status, 'paid');
  assert.equal(after.delivery_code, null);
});
