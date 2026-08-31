import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { getDb, initDb, seedDb, resetDbForTests } from '../src/db/connection.js';
import { createOrder, getOrder } from '../src/services/orderService.js';
import { processPaymentWebhook, countWebhookEvents, applyPendingWebhooksForOrder } from '../src/services/webhookService.js';
import { resetSupplierMocks } from '../src/mocks/supplierMocks.js';

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

test('duplicate event_id is no-op', async () => {
  const order = createOrder('KEY-CS2-PRIME');
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
