import { jsonPost, jsonGet } from './lib/http.js';

const CONCURRENCY = 50;
const OFFER_ID = 'off_KEY-CS2-PRIME_2';

async function main() {
  const { body: order } = await jsonPost('/api/orders', { offerId: OFFER_ID });
  if (!order.id) throw new Error('Failed to create order');
  if (order.status !== 'reserved') throw new Error(`Expected reserved, got ${order.status}`);

  const eventId = `evt_race_${Date.now()}`;
  const payload = {
    event_id: eventId,
    order_id: order.id,
    status: 'paid',
    amount: order.final_amount,
    currency: 'RUB',
    created_at: new Date().toISOString(),
  };

  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, () => jsonPost('/webhook/payment', payload)),
  );

  const all200 = results.every((r) => r.status === 200);
  const { body: finalOrder } = await jsonGet(`/api/orders/${order.id}`);

  if (!all200) throw new Error('Not all webhooks returned 200');
  if (finalOrder.status !== 'delivered') throw new Error(`Expected delivered, got ${finalOrder.status}`);
  if (!finalOrder.delivery_code) throw new Error('No delivery code');

  console.log(`PASS: ${CONCURRENCY} parallel webhooks → 1 delivery (${finalOrder.delivery_code})`);
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
