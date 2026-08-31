import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import request from 'supertest';
import { resetDbForTests } from '../src/db/connection.js';

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
