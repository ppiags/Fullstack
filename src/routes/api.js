import { Router } from 'express';
import { createOrder, ensureHoldActive, getOrder } from '../services/orderService.js';
import { applyPendingWebhooksForOrder } from '../services/webhookService.js';
import { applyPromoToOrder, validatePromo } from '../services/promoService.js';
import { markAllKeysAssigned, replenishKeys } from '../services/keyPoolService.js';
import { getDb } from '../db/connection.js';
import { listAlternatives, listCatalog, listCatalogOffers } from '../services/offerService.js';

const router = Router();

router.get('/catalog', (req, res) => {
  res.json(listCatalog(req.query));
});

router.get('/catalog/offers', (req, res) => {
  const sku = String(req.query.sku ?? '').trim();
  if (!sku) return res.status(400).json({ error: 'SKU_REQUIRED' });
  const body = listCatalogOffers(sku);
  if (!body) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json(body);
});

router.post('/orders', async (req, res) => {
  const { offerId, id, idempotency_key: idempotencyKey } = req.body ?? {};
  if (!offerId) return res.status(400).json({ error: 'OFFER_ID_REQUIRED' });
  const forcedId = process.env.ALLOW_TEST_ORDER_ID === '1' ? id : null;

  if (idempotencyKey) {
    const existing = getDb().prepare(
      'SELECT order_id FROM order_idempotency WHERE idempotency_key = ?',
    ).get(idempotencyKey);
    if (existing) {
      return res.status(200).json(getOrder(existing.order_id));
    }
  }

  try {
    const order = createOrder({
      offerId,
      forcedId,
      idempotencyKey: idempotencyKey || null,
    });
    await applyPendingWebhooksForOrder(order.id);
    res.status(201).json(getOrder(order.id));
  } catch (e) {
    if (e.code === 'OFFER_NOT_FOUND') return res.status(404).json({ error: 'OFFER_NOT_FOUND' });
    if (e.code === 'SOLD_OUT') {
      const offer = getDb().prepare('SELECT product_sku FROM offers WHERE id = ?').get(offerId);
      return res.status(409).json({
        error: 'SOLD_OUT',
        message: 'Товар только что раскупили',
        alternatives: offer ? listAlternatives(offer.product_sku, offerId) : [],
      });
    }
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const existing = getDb().prepare(
        'SELECT order_id FROM order_idempotency WHERE idempotency_key = ?',
      ).get(idempotencyKey);
      if (existing) return res.status(200).json(getOrder(existing.order_id));
    }
    throw e;
  }
});

router.get('/orders/:id', (req, res) => {
  const order = ensureHoldActive(req.params.id);
  if (!order) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ ...order, serverNow: new Date().toISOString() });
});

router.post('/orders/:id/apply-promo', (req, res) => {
  const { code } = req.body ?? {};
  if (!code) return res.status(400).json({ error: 'CODE_REQUIRED' });
  const order = ensureHoldActive(req.params.id);
  if (!order) return res.status(404).json({ error: 'NOT_FOUND' });
  if (order.status === 'hold_expired') {
    return res.status(409).json({ error: 'HOLD_EXPIRED' });
  }
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
    const offerId = req.body?.offerId || null;
    const replenished = replenishKeys(count, offerId);
    res.json({ ok: true, replenished });
  });

  router.post('/test/set-offer-stock', (req, res) => {
    const { offerId, stockAvailable } = req.body ?? {};
    if (!offerId || stockAvailable === undefined) {
      return res.status(400).json({ error: 'OFFER_ID_AND_STOCK_REQUIRED' });
    }
    const stock = Math.max(0, parseInt(stockAvailable, 10));
    const now = new Date().toISOString();
    const info = getDb().prepare(`
      UPDATE offers SET stock_available = ?, stock_reserved = 0, updated_at = ?
      WHERE id = ?
    `).run(stock, now, offerId);
    if (info.changes !== 1) return res.status(404).json({ error: 'OFFER_NOT_FOUND' });
    res.json({ ok: true, offerId, stockAvailable: stock });
  });

  router.post('/test/reset-db', (_req, res) => {
    const db = getDb();
    const now = new Date().toISOString();
    db.exec(`
      DELETE FROM promo_redemptions;
      DELETE FROM order_idempotency;
      DELETE FROM pending_webhooks;
      DELETE FROM webhook_events;
      DELETE FROM orders;
      UPDATE keys SET status = 'available', order_id = NULL, assigned_at = NULL;
      UPDATE promocodes SET used_count = 0;
    `);
    // Счётчики offers должны совпасть с ключами: иначе следующие race падают на SOLD_OUT.
    db.prepare(`
      UPDATE offers
      SET stock_available = (
            SELECT COUNT(*) FROM keys
            WHERE keys.offer_id = offers.id AND keys.status = 'available'
          ),
          stock_reserved = 0,
          updated_at = ?
    `).run(now);
    db.prepare(`
      UPDATE offers SET stock_available = 1, stock_reserved = 0, updated_at = ?
      WHERE id = 'off_race_last'
    `).run(now);
    db.prepare(`
      UPDATE offers
      SET price = (SELECT price FROM products WHERE sku = offers.product_sku) - 10,
          updated_at = ?
      WHERE id = 'off_race_last'
    `).run(now);
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
