import { Router } from 'express';
import { createOrder, getOrder } from '../services/orderService.js';
import { applyPendingWebhooksForOrder } from '../services/webhookService.js';
import { applyPromoToOrder, validatePromo } from '../services/promoService.js';
import { markAllKeysAssigned, replenishKeys } from '../services/keyPoolService.js';
import { getDb } from '../db/connection.js';

const router = Router();

router.get('/products', (_req, res) => {
  const products = getDb().prepare('SELECT * FROM products').all();
  res.json({ products });
});

router.post('/orders', async (req, res) => {
  const { sku, id, idempotency_key: idempotencyKey } = req.body ?? {};
  if (!sku) return res.status(400).json({ error: 'SKU_REQUIRED' });
  const forcedId = process.env.ALLOW_TEST_ORDER_ID === '1' ? id : null;
  try {
    const order = createOrder(sku, forcedId, idempotencyKey || null);
    await applyPendingWebhooksForOrder(order.id);
    res.status(201).json(getOrder(order.id));
  } catch (e) {
    if (e.code === 'PRODUCT_NOT_FOUND') return res.status(404).json({ error: 'PRODUCT_NOT_FOUND' });
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const existing = getDb().prepare(
        'SELECT order_id FROM order_idempotency WHERE idempotency_key = ?',
      ).get(idempotencyKey);
      if (existing) return res.status(201).json(getOrder(existing.order_id));
    }
    throw e;
  }
});

router.get('/orders/:id', (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json(order);
});

router.post('/orders/:id/apply-promo', (req, res) => {
  const { code } = req.body ?? {};
  if (!code) return res.status(400).json({ error: 'CODE_REQUIRED' });
  const result = applyPromoToOrder(req.params.id, code);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result.order);
});

if (process.env.ALLOW_TEST_ORDER_ID === '1') {
  router.post('/test/drain-keys', (_req, res) => {
    markAllKeysAssigned();
    res.json({ ok: true });
  });

  router.post('/test/replenish-keys', (req, res) => {
    const count = Math.max(1, parseInt(req.body?.count, 10) || 1);
    const replenished = replenishKeys(count);
    res.json({ ok: true, replenished });
  });

  router.post('/test/reset-db', (_req, res) => {
    const db = getDb();
    db.exec(`
      DELETE FROM promo_redemptions;
      DELETE FROM order_idempotency;
      DELETE FROM pending_webhooks;
      DELETE FROM webhook_events;
      DELETE FROM orders;
      UPDATE keys SET status = 'available', order_id = NULL, assigned_at = NULL;
      UPDATE promocodes SET used_count = 0;
    `);
    res.json({ ok: true });
  });
}

router.post('/promo/validate', (req, res) => {
  const { code, sku } = req.body ?? {};
  if (!code || !sku) return res.status(400).json({ error: 'CODE_AND_SKU_REQUIRED' });
  const result = validatePromo(code, sku);
  if (!result.valid) return res.status(400).json({ error: result.error });
  res.json(result);
});

export default router;
