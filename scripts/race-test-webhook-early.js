import { jsonPost, jsonGet } from './lib/http.js';

const OFFER_ID = 'off_KEY-CS2-PRIME_2';

async function main() {
  const orderId = `ord_early_${Date.now().toString(36)}`;
  const payload = {
    event_id: `evt_early_${Date.now()}`,
    order_id: orderId,
    status: 'paid',
    amount: 1310,
    currency: 'RUB',
    created_at: new Date().toISOString(),
  };

  await jsonPost('/webhook/payment', payload);

  const { body: order } = await jsonPost('/api/orders', {
    offerId: OFFER_ID,
    id: orderId,
  });

  if (order.status !== 'delivered' && order.status !== 'paid') {
    // poll briefly
    await new Promise((r) => setTimeout(r, 500));
  }
  const { body: finalOrder } = await jsonGet(`/api/orders/${orderId}`);

  if (!['delivered', 'paid', 'delivering'].includes(finalOrder.status)) {
    throw new Error(`Unexpected status after early webhook: ${finalOrder.status}`);
  }
  if (finalOrder.status === 'delivered' && !finalOrder.delivery_code) {
    throw new Error('Delivered without code');
  }

  console.log(`PASS: early webhook applied → status=${finalOrder.status}`);
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
