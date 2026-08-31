import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { getDb, initDb, seedDb, resetDbForTests } from '../src/db/connection.js';

const TEST_DB = './data/test-store.db';

before(() => {
  resetDbForTests();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  process.env.DB_PATH = TEST_DB;
});

after(() => {
  resetDbForTests();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

test('seed loads products and keys', () => {
  const db = getDb();
  initDb(db);
  seedDb(db);
  const products = db.prepare('SELECT COUNT(*) AS c FROM products').get();
  const keys = db.prepare('SELECT COUNT(*) AS c FROM keys').get();
  assert.ok(products.c >= 12);
  assert.ok(keys.c >= 50);
});
