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

test('GET /api/admin/orders returns all by default', async () => {
  createOrder('KEY-CS2-PRIME');
  const o2 = createOrder('KEY-CS2-PRIME');
  transitionOrder(o2.id, 'created', 'paid');
  transitionOrder(o2.id, 'paid', 'delivered', { delivery_code: 'KEY-1' });

  const { createApp } = await import('../src/server.js');
  const res = await request(createApp())
    .get('/api/admin/orders')
    .set('X-Admin-Token', TOKEN);

  assert.equal(res.status, 200);
  assert.equal(res.body.orders.length, 2);
});

test('GET /api/admin/orders?status=delivered filters', async () => {
  createOrder('KEY-CS2-PRIME');
  const o2 = createOrder('KEY-CS2-PRIME');
  transitionOrder(o2.id, 'created', 'paid');
  transitionOrder(o2.id, 'paid', 'delivered', { delivery_code: 'KEY-1' });

  const { createApp } = await import('../src/server.js');
  const res = await request(createApp())
    .get('/api/admin/orders?status=delivered')
    .set('X-Admin-Token', TOKEN);

  assert.equal(res.status, 200);
  assert.equal(res.body.orders.length, 1);
  assert.equal(res.body.orders[0].status, 'delivered');
});
