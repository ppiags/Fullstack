import { jsonPost, jsonGet } from './lib/http.js';

const CONCURRENCY = 20;
const KEY = `buy_race_${Date.now()}`;

async function main() {
  const attempts = await Promise.all(
    Array.from({ length: CONCURRENCY }, () =>
      jsonPost('/api/orders', { sku: 'KEY-CS2-PRIME', idempotency_key: KEY }),
    ),
  );

  const orderIds = new Set(attempts.map((a) => a.body.id).filter(Boolean));
  if (orderIds.size !== 1) {
    throw new Error(`Expected 1 order, got ${orderIds.size}`);
  }
  if (!attempts.every((a) => a.status === 201)) {
    throw new Error('Not all parallel buy requests returned 201');
  }

  console.log(`PASS: ${CONCURRENCY} parallel buy clicks → 1 order (${[...orderIds][0]})`);
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
