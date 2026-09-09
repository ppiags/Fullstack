import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { shouldCreateNewOrder } from '../public/js/catalog-buy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogBuyUrl = pathToFileURL(path.join(root, 'public/js/catalog-buy.js')).href;

test('shouldCreateNewOrder only for hold_expired and payment_failed', () => {
  assert.equal(shouldCreateNewOrder('hold_expired'), true);
  assert.equal(shouldCreateNewOrder('payment_failed'), true);
  for (const status of ['reserved', 'paid', 'delivering', 'delivered', 'out_of_stock', 'delivery_failed', 'unknown']) {
    assert.equal(shouldCreateNewOrder(status), false, status);
  }
});

function runBuyOfferScenario(scenario) {
  const script = `
    const storage = new Map();
    globalThis.sessionStorage = {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(k, String(v)); },
      removeItem: (k) => { storage.delete(k); },
    };
    globalThis.location = { href: '' };
    globalThis.document = { querySelectorAll: () => [], getElementById: () => null };
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: () => 'uuid-test-1' },
      configurable: true,
    });

    const fetchCalls = [];
    globalThis.fetch = async (url, opts = {}) => {
      fetchCalls.push({ url, method: opts.method || 'GET', body: opts.body });
      if (url === '/api/orders/${scenario.orderId}') {
        if (${scenario.getStatus === 404}) {
          return { ok: false, status: 404, json: async () => ({}) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: '${scenario.orderId}', status: '${scenario.getStatus}' }),
        };
      }
      if (url === '/api/orders' && opts.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'ord_new', status: 'reserved' }),
        };
      }
      throw new Error('unexpected fetch ' + url + ' ' + (opts.method || 'GET'));
    };

    storage.set('order:${scenario.offerId}', '${scenario.orderId}');
    ${scenario.seedIdem ? `storage.set('idem:${scenario.offerId}', 'old-idem');` : ''}

    const { buyOffer } = await import(${JSON.stringify(catalogBuyUrl)});
    await buyOffer(
      '${scenario.offerId}',
      { disabled: false },
      new Map([['${scenario.offerId}', { stockAvailable: 5 }]]),
    );

    console.log(JSON.stringify({
      href: globalThis.location.href,
      posted: fetchCalls.some((c) => c.url === '/api/orders' && c.method === 'POST'),
      postBody: fetchCalls.find((c) => c.url === '/api/orders' && c.method === 'POST')?.body ?? null,
      orderKey: storage.get('order:${scenario.offerId}') ?? null,
      idemKey: storage.get('idem:${scenario.offerId}') ?? null,
      hadOldIdem: storage.has('idem:${scenario.offerId}') && storage.get('idem:${scenario.offerId}') === 'old-idem',
    }));
  `;

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`buyOffer scenario failed:\n${result.stderr}\n${result.stdout}`);
  }
  return JSON.parse(result.stdout.trim());
}

const offerId = 'off_1';
const orderId = 'ord_1';

for (const status of ['out_of_stock', 'delivering', 'delivery_failed']) {
  test(`buyOffer: existing ${status} redirects without POST`, () => {
    const out = runBuyOfferScenario({ offerId, orderId, getStatus: status });
    assert.match(out.href, /ord_1/, 'should redirect to existing order');
    assert.equal(out.posted, false, 'POST /api/orders must not run for terminal status');
  });
}

test('buyOffer: hold_expired clears keys and POSTs new order', () => {
  const out = runBuyOfferScenario({ offerId, orderId, getStatus: 'hold_expired', seedIdem: true });
  assert.equal(out.posted, true, 'POST /api/orders must run for hold_expired');
  assert.equal(JSON.parse(out.postBody).idempotency_key, 'uuid-test-1', 'fresh idempotency key after clear');
  assert.equal(out.hadOldIdem, false, 'old idem key must be cleared before POST');
  assert.equal(out.orderKey, 'ord_new', 'new order id stored after POST');
});

test('buyOffer: GET 404 clears stale key and POSTs', () => {
  const out = runBuyOfferScenario({ offerId, orderId, getStatus: 404 });
  assert.equal(out.posted, true, 'POST /api/orders must run after 404');
});
