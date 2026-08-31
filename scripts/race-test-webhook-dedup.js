import { jsonPost, jsonGet } from './lib/http.js';

async function main() {
  const { body: order } = await jsonPost('/api/orders', { sku: 'KEY-CS2-PRIME' });
  const payload = {
    event_id: 'evt_dedup_test',
    order_id: order.id,
    status: 'paid',
    amount: order.final_amount,
    currency: 'RUB',
    created_at: new Date().toISOString(),
  };

  await jsonPost('/webhook/payment', payload);
  const after1 = (await jsonGet(`/api/orders/${order.id}`)).body;

  await jsonPost('/webhook/payment', payload);
  const after2 = (await jsonGet(`/api/orders/${order.id}`)).body;

  if (after1.delivery_code !== after2.delivery_code) throw new Error('Delivery code changed on duplicate');
  if (after1.status !== after2.status) throw new Error('Status changed on duplicate');

  console.log('PASS: duplicate event_id is no-op');
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
