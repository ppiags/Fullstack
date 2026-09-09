import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import request from 'supertest';
import { getDb, resetDbForTests } from '../src/db/connection.js';
import { createOrder } from '../src/services/orderService.js';

const TEST_DB = './data/test-server.db';

before(() => {
  resetDbForTests();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  process.env.DB_PATH = TEST_DB;
});

after(() => {
  resetDbForTests();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

test('GET /api/health returns ok', async () => {
  const { createApp } = await import('../src/server.js');
  const app = createApp();
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('POST /webhook/payment returns 200 before deliver finishes', async () => {
  process.env.SUPPLIER_A_HANG_MS = '2000';
  process.env.SUPPLIER_B_HANG_MS = '2000';
  const { createApp } = await import('../src/server.js');
  const app = createApp();
  const order = createOrder({ offerId: 'off_race_last' });
  const t0 = Date.now();
  const res = await request(app).post('/webhook/payment').send({
    event_id: 'evt_http_fast',
    order_id: order.id,
    status: 'paid',
    amount: order.final_amount,
    currency: 'RUB',
    created_at: new Date().toISOString(),
  });
  const elapsed = Date.now() - t0;
  assert.equal(res.status, 200);
  assert.ok(elapsed < 1500, `webhook took ${elapsed}ms, expected < hang`);
  const { getOrder } = await import('../src/services/orderService.js');
  assert.notEqual(getOrder(order.id).status, 'delivered');
  delete process.env.SUPPLIER_A_HANG_MS;
  delete process.env.SUPPLIER_B_HANG_MS;
  await new Promise((r) => setTimeout(r, 2100));
});

test('POST /api/pay/:orderId returns HOLD_EXPIRED after hold timeout', async () => {
  const { createApp } = await import('../src/server.js');
  const app = createApp();
  const order = createOrder({ offerId: 'off_race_last' });
  getDb().prepare('UPDATE orders SET hold_expires_at = ? WHERE id = ?')
    .run(new Date(0).toISOString(), order.id);

  const res = await request(app).post(`/api/pay/${order.id}`).send({ result: 'success' });
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: 'HOLD_EXPIRED' });
});
