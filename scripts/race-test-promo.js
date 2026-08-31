import { jsonPost } from './lib/http.js';

const CONCURRENCY = 8;
const CODE = 'LIMIT3';

async function main() {
  const attempts = await Promise.all(
    Array.from({ length: CONCURRENCY }, async (_, i) => {
      const { body: order } = await jsonPost('/api/orders', { sku: 'KEY-CS2-PRIME' });
      const res = await jsonPost(`/api/orders/${order.id}/apply-promo`, { code: CODE });
      return { ok: res.status === 200, orderId: order.id };
    }),
  );

  const success = attempts.filter((a) => a.ok).length;
  if (success > 3) throw new Error(`LIMIT3 applied ${success} times, expected max 3`);
  if (success < 1) throw new Error('Expected at least 1 successful apply');

  console.log(`PASS: LIMIT3 applied ${success}/3 under ${CONCURRENCY} parallel requests`);
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
