import { jsonPost } from './lib/http.js';

const OFFER_ID = 'off_race_last';
const CONCURRENCY = 20;

async function main() {
  const reset = await jsonPost('/api/test/set-offer-stock', {
    offerId: OFFER_ID,
    stockAvailable: 1,
  });
  if (reset.status !== 200 || !reset.body.ok) {
    throw new Error('Failed to reset offer stock to 1');
  }

  const attempts = await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) =>
      jsonPost('/api/orders', {
        offerId: OFFER_ID,
        idempotency_key: `last_unit_${Date.now()}_${i}`,
      }),
    ),
  );

  const winners = attempts.filter((a) => a.status === 201);
  const soldOut = attempts.filter((a) => a.status === 409 && a.body.error === 'SOLD_OUT');

  if (winners.length !== 1) {
    throw new Error(`Expected 1 winner (201), got ${winners.length}`);
  }
  if (soldOut.length !== CONCURRENCY - 1) {
    throw new Error(`Expected ${CONCURRENCY - 1} SOLD_OUT, got ${soldOut.length}`);
  }
  if (winners[0].body.status !== 'reserved') {
    throw new Error(`Expected reserved status, got ${winners[0].body.status}`);
  }
  if (winners[0].body.offer_id !== OFFER_ID) {
    throw new Error(`Expected offer_id ${OFFER_ID}, got ${winners[0].body.offer_id}`);
  }

  console.log(
    `PASS: ${CONCURRENCY} parallel last-unit → 1 reserved (${winners[0].body.id}), ${soldOut.length} SOLD_OUT`,
  );
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
