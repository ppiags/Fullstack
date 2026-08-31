import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { getDb, initDb, seedDb, resetDbForTests } from '../src/db/connection.js';
import {
  createOrder,
  getOrder,
  transitionOrder,
  listOrdersByStatus,
  listAllOrders,
} from '../src/services/orderService.js';

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

test('createOrder from product', () => {
  const order = createOrder('KEY-CS2-PRIME');
  assert.equal(order.status, 'created');
  assert.equal(order.final_amount, 1290);
});

test('transition created to paid', () => {
  const order = createOrder('KEY-CS2-PRIME');
  const r = transitionOrder(order.id, 'created', 'paid');
  assert.equal(r.changed, true);
  assert.equal(getOrder(order.id).status, 'paid');
});

test('final state cannot transition', () => {
  const order = createOrder('KEY-CS2-PRIME');
  transitionOrder(order.id, 'created', 'payment_failed');
  const r = transitionOrder(order.id, 'payment_failed', 'paid');
  assert.equal(r.changed, false);
});

test('createOrder idempotency returns same order', () => {
  const a = createOrder('KEY-CS2-PRIME', null, 'test-key-1');
  const b = createOrder('KEY-CS2-PRIME', null, 'test-key-1');
  assert.equal(a.id, b.id);
});

test('listAllOrders returns all orders sorted by created_at desc', () => {
  const a = createOrder('KEY-CS2-PRIME');
  transitionOrder(a.id, 'created', 'paid');
  const b = createOrder('KEY-CS2-PRIME');
  const all = listAllOrders();
  assert.equal(all.length, 2);
  assert.ok(all[0].created_at >= all[1].created_at);
});

test('listOrdersByStatus filters single status', () => {
  const a = createOrder('KEY-CS2-PRIME');
  transitionOrder(a.id, 'created', 'paid');
  createOrder('KEY-CS2-PRIME');
  const paid = listOrdersByStatus(['paid']);
  assert.equal(paid.length, 1);
  assert.equal(paid[0].id, a.id);
});
