import { jsonPost } from './lib/http.js';

const CONCURRENCY = 20;
const OFFER_ID = 'off_KEY-CS2-PRIME_2';
const KEY = `buy_race_${Date.now()}`;

async function main() {
  const attempts = await Promise.all(
    Array.from({ length: CONCURRENCY }, () =>
      jsonPost('/api/orders', { offerId: OFFER_ID, idempotency_key: KEY }),
    ),
  );

  const orderIds = new Set(attempts.map((a) => a.body.id).filter(Boolean));
  if (orderIds.size !== 1) {
    throw new Error(`Expected 1 order, got ${orderIds.size}`);
  }
  const statuses = attempts.map((a) => a.status);
  if (!statuses.every((s) => s === 200 || s === 201)) {
    throw new Error(`Unexpected statuses: ${statuses.join(',')}`);
  }
  if (!statuses.includes(201)) {
    throw new Error('Expected at least one 201 response');
  }
  const winner = attempts.find((a) => a.status === 201);
  if (winner.body.status !== 'reserved') {
    throw new Error(`Expected reserved status, got ${winner.body.status}`);
  }

  console.log(`PASS: ${CONCURRENCY} parallel buy clicks → 1 reserved order (${[...orderIds][0]}), idempotent 200/201`);
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
