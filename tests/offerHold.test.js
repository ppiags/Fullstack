import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { getDb, initDb, seedDb, resetDbForTests } from '../src/db/connection.js';
import { attachClient, broadcast, clearClients } from '../src/services/wsHub.js';
import {
  getOffer,
  holdOffer,
  releaseHold,
  consumeReserved,
  listCatalog,
  listAlternatives,
  patchOffer,
} from '../src/services/offerService.js';

const TEST_DB = './data/test-offer-hold.db';

beforeEach(() => {
  resetDbForTests();
  clearClients();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  process.env.DB_PATH = TEST_DB;
  const db = getDb();
  initDb(db);
  seedDb(db);
});

afterEach(() => {
  resetDbForTests();
  clearClients();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

test('hold decreases available and increases reserved', () => {
  const before = getOffer('off_race_last');
  holdOffer('off_race_last');
  const after = getOffer('off_race_last');
  assert.equal(after.stock_available, before.stock_available - 1);
  assert.equal(after.stock_reserved, before.stock_reserved + 1);
});

test('holdOffer returns ok and updated offer', () => {
  const result = holdOffer('off_race_last');
  assert.equal(result.ok, true);
  assert.equal(result.offer.id, 'off_race_last');
  assert.equal(result.offer.stock_available, 0);
  assert.equal(result.offer.stock_reserved, 1);
});

test('second hold on last unit throws SOLD_OUT', () => {
  holdOffer('off_race_last');
  assert.throws(() => holdOffer('off_race_last'), (e) => e.code === 'SOLD_OUT');
});

test('holdOffer throws OFFER_NOT_FOUND for unknown offer', () => {
  assert.throws(() => holdOffer('off_missing'), (e) => e.code === 'OFFER_NOT_FOUND');
});

test('releaseHold reverses available and reserved counters', () => {
  holdOffer('off_race_last');
  const held = getOffer('off_race_last');
  releaseHold('off_race_last');
  const after = getOffer('off_race_last');
  assert.equal(after.stock_available, held.stock_available + 1);
  assert.equal(after.stock_reserved, held.stock_reserved - 1);
});

test('consumeReserved decreases reserved without restoring available', () => {
  holdOffer('off_race_last');
  const held = getOffer('off_race_last');
  consumeReserved('off_race_last');
  const after = getOffer('off_race_last');
  assert.equal(after.stock_available, held.stock_available);
  assert.equal(after.stock_reserved, held.stock_reserved - 1);
});

test('listCatalog returns paginated products', () => {
  const catalog = listCatalog();
  assert.ok(catalog.serverNow);
  assert.equal(catalog.items, undefined);
  assert.equal(catalog.limit, 20);
  assert.equal(catalog.products.length, 20);
  assert.ok(catalog.total > 20);
  const cs2 = listCatalog({ q: 'KEY-CS2-PRIME' });
  assert.ok(cs2.products.some((p) => p.sku === 'KEY-CS2-PRIME'));
});

test('listAlternatives returns other in-stock offers for same sku', () => {
  holdOffer('off_race_last');
  const alternatives = listAlternatives('KEY-CS2-PRIME', 'off_race_last');
  assert.ok(Array.isArray(alternatives));
  assert.ok(alternatives.every((o) => o.offerId !== 'off_race_last'));
  assert.ok(alternatives.every((o) => o.stockAvailable > 0));
  assert.ok(alternatives.every((o) => o.sku === 'KEY-CS2-PRIME'));
});

test('patchOffer updates price and stock and broadcasts', () => {
  const messages = [];
  attachClient({ readyState: 1, send: (data) => messages.push(JSON.parse(data)) });

  const updated = patchOffer('off_race_last', { price: 999, stockAvailable: 5 });
  assert.equal(updated.price, 999);
  assert.equal(updated.stock_available, 5);

  const offerUpdated = messages.find((m) => m.type === 'offer.updated');
  assert.ok(offerUpdated);
  assert.equal(offerUpdated.offerId, 'off_race_last');
  assert.equal(offerUpdated.price, 999);
  assert.equal(offerUpdated.stockAvailable, 5);
  assert.equal(offerUpdated.sku, 'KEY-CS2-PRIME');
  assert.equal(typeof offerUpdated.minPrice, 'number');
  assert.equal(typeof offerUpdated.offerCount, 'number');
  const product = listCatalog({ q: 'KEY-CS2-PRIME' }).products.find((p) => p.sku === 'KEY-CS2-PRIME');
  assert.ok(product);
  assert.equal(offerUpdated.minPrice, product.minPrice);
  assert.equal(offerUpdated.offerCount, product.offerCount);
  assert.equal(typeof offerUpdated.buyOfferId, 'string');
  assert.equal(typeof offerUpdated.buyStockAvailable, 'number');
  assert.equal(offerUpdated.buyOfferId, product.buyOfferId);
  assert.equal(offerUpdated.buyStockAvailable, product.buyStockAvailable);
});

test('holdOffer broadcasts offer.updated', () => {
  const messages = [];
  attachClient({ readyState: 1, send: (data) => messages.push(JSON.parse(data)) });

  holdOffer('off_race_last');

  const msg = messages.find((m) => m.type === 'offer.updated');
  assert.ok(msg);
  assert.equal(msg.offerId, 'off_race_last');
  assert.equal(msg.stockAvailable, 0);
  assert.equal(msg.stockReserved, 1);
  assert.equal(msg.sku, 'KEY-CS2-PRIME');
  const soldOut = messages.find((m) => m.type === 'offer.sold_out');
  assert.ok(soldOut);
  assert.equal(soldOut.offerId, 'off_race_last');
  assert.equal(soldOut.sku, 'KEY-CS2-PRIME');
  assert.equal(soldOut.stockAvailable, 0);
});

test('wsHub broadcast sends JSON to attached clients', () => {
  const messages = [];
  attachClient({ readyState: 1, send: (data) => messages.push(JSON.parse(data)) });

  broadcast('offer.updated', { offerId: 'off_1', price: 100 });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'offer.updated');
  assert.equal(messages[0].offerId, 'off_1');
  assert.equal(messages[0].price, 100);
});
