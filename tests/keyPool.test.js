import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { getDb, initDb, resetDbForTests } from '../src/db/connection.js';
import { claimKey, getKeyByOrderId } from '../src/services/keyPoolService.js';

const TEST_DB = './data/test-keypool.db';

beforeEach(() => {
  resetDbForTests();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  process.env.DB_PATH = TEST_DB;
  const db = getDb();
  initDb(db);
  db.prepare(`INSERT INTO keys (code, status, offer_id) VALUES ('TEST-KEY-1', 'available', 'off_1')`).run();
  db.prepare(`INSERT INTO keys (code, status, offer_id) VALUES ('TEST-KEY-2', 'available', 'off_2')`).run();
});

afterEach(() => {
  resetDbForTests();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

test('claimKey assigns one key', () => {
  const r = claimKey('ord_1', 'off_1');
  assert.equal(r.ok, true);
  assert.equal(getKeyByOrderId('ord_1'), r.code);
});

test('claimKey is idempotent for same order', () => {
  const r1 = claimKey('ord_1', 'off_1');
  const r2 = claimKey('ord_1', 'off_1');
  assert.equal(r1.code, r2.code);
});

test('claimKey returns out_of_stock when empty', () => {
  claimKey('ord_x', 'off_1');
  claimKey('ord_y', 'off_1');
  const r = claimKey('ord_z', 'off_1');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'out_of_stock');
});
