import { jsonPost, jsonGet } from './lib/http.js';

async function main() {
  await jsonPost('/api/test/drain-keys', {});

  const { body: order } = await jsonPost('/api/orders', { sku: 'KEY-CS2-PRIME' });
  await jsonPost(`/api/pay/${order.id}`, { result: 'success' });
  await new Promise((r) => setTimeout(r, 300));

  let final = (await jsonGet(`/api/orders/${order.id}`)).body;
  if (final.status !== 'out_of_stock') {
    throw new Error(`Expected out_of_stock, got ${final.status}`);
  }

  const repl = await jsonPost('/api/test/replenish-keys', { count: 1 });
  if (repl.body.replenished < 1) throw new Error('Failed to replenish keys');

  const retry = await jsonPost(`/api/admin/orders/${order.id}/retry`, {}, {
    'X-Admin-Token': process.env.ADMIN_TOKEN || 'dev-admin-token',
  });
  if (retry.status !== 200) throw new Error('Admin retry failed');

  final = (await jsonGet(`/api/orders/${order.id}`)).body;
  if (final.status !== 'delivered') {
    throw new Error(`Expected delivered after retry, got ${final.status}`);
  }
  if (!final.delivery_code) throw new Error('No delivery code after recovery');

  console.log(`PASS: out_of_stock → replenish → delivered (${final.delivery_code})`);
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
