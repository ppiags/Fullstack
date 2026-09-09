// tests/seedOffers.test.js
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { getDb, initDb, seedDb, resetDbForTests } from '../src/db/connection.js';

const TEST_DB = './data/test-seed-offers.db';

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

test('seed creates many offers with keys', () => {
  const db = getDb();
  const { c: offers } = db.prepare('SELECT COUNT(*) AS c FROM offers').get();
  assert.ok(offers >= 3000);
  const row = db.prepare(`
    SELECT o.id, o.stock_available,
      (SELECT COUNT(*) FROM keys k WHERE k.offer_id = o.id AND k.status = 'available') AS keys
    FROM offers o LIMIT 1
  `).get();
  assert.equal(row.keys, row.stock_available);
});
