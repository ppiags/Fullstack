import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/connection.js';
import { HOLD_TTL_MS } from '../config.js';
import { getOffer, releaseHold, emitOfferUpdated } from './offerService.js';
import { broadcast } from './wsHub.js';

const FINAL = new Set(['delivered', 'payment_failed', 'hold_expired']);

export function createOrder({ offerId, forcedId = null, idempotencyKey = null } = {}) {
  if (!offerId) {
    const err = new Error('OFFER_ID_REQUIRED');
    err.code = 'OFFER_ID_REQUIRED';
    throw err;
  }

  const db = getDb();
  db.prepare('BEGIN IMMEDIATE').run();
  try {
    if (idempotencyKey) {
      const row = db.prepare(
        'SELECT order_id FROM order_idempotency WHERE idempotency_key = ?',
      ).get(idempotencyKey);
      if (row) {
        db.prepare('COMMIT').run();
        return getOrder(row.order_id);
      }
    }

    const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId);
    if (!offer) {
      const err = new Error('OFFER_NOT_FOUND');
      err.code = 'OFFER_NOT_FOUND';
      throw err;
    }
    if (offer.stock_available < 1) {
      const err = new Error('SOLD_OUT');
      err.code = 'SOLD_OUT';
      throw err;
    }

    const now = new Date().toISOString();
    const holdExpiresAt = new Date(Date.now() + HOLD_TTL_MS).toISOString();

    const holdResult = db.prepare(`
      UPDATE offers SET
        stock_available = stock_available - 1,
        stock_reserved = stock_reserved + 1,
        updated_at = ?
      WHERE id = ? AND stock_available >= 1
    `).run(now, offerId);

    if (holdResult.changes !== 1) {
      const err = new Error('SOLD_OUT');
      err.code = 'SOLD_OUT';
      throw err;
    }

    const id = forcedId || `ord_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
    const order = {
      id,
      sku: offer.product_sku,
      offer_id: offerId,
      status: 'reserved',
      amount: offer.price,
      currency: offer.currency,
      promo_code: null,
      discount_amount: 0,
      final_amount: offer.price,
      delivery_code: null,
      delivery_request_id: id,
      hold_expires_at: holdExpiresAt,
      created_at: now,
      updated_at: now,
    };

    db.prepare(`
      INSERT INTO orders (id, sku, offer_id, status, amount, currency, promo_code, discount_amount,
        final_amount, delivery_code, delivery_request_id, hold_expires_at, created_at, updated_at)
      VALUES (@id, @sku, @offer_id, @status, @amount, @currency, @promo_code, @discount_amount,
        @final_amount, @delivery_code, @delivery_request_id, @hold_expires_at, @created_at, @updated_at)
    `).run(order);

    if (idempotencyKey) {
      db.prepare(`
        INSERT INTO order_idempotency (idempotency_key, order_id, created_at)
        VALUES (?, ?, ?)
      `).run(idempotencyKey, id, now);
    }

    db.prepare('COMMIT').run();
    emitOfferUpdated(getOffer(offerId));
    return order;
  } catch (e) {
    db.prepare('ROLLBACK').run();
    if (idempotencyKey && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const row = db.prepare(
        'SELECT order_id FROM order_idempotency WHERE idempotency_key = ?',
      ).get(idempotencyKey);
      if (row) return getOrder(row.order_id);
    }
    throw e;
  }
}

export function getOrder(id) {
  return getDb().prepare('SELECT * FROM orders WHERE id = ?').get(id) ?? null;
}

export function releaseHoldForOrder(orderId) {
  const db = getDb();
  db.prepare('BEGIN IMMEDIATE').run();
  let offerId = null;
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order || order.status !== 'reserved') {
      db.prepare('COMMIT').run();
      return { changed: false };
    }

    offerId = order.offer_id;
    const now = new Date().toISOString();
    const info = db.prepare(`
      UPDATE orders SET status = 'hold_expired', updated_at = ?
      WHERE id = ? AND status = 'reserved'
    `).run(now, orderId);

    if (info.changes !== 1) {
      db.prepare('COMMIT').run();
      return { changed: false };
    }

    db.prepare('COMMIT').run();
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }

  if (offerId) {
    releaseHold(offerId);
  }
  broadcast('order.hold_expired', { orderId });
  return { changed: true };
}

export function expireDueHolds(now = Date.now()) {
  const nowIso = new Date(now).toISOString();
  const rows = getDb().prepare(`
    SELECT id FROM orders
    WHERE status = 'reserved' AND hold_expires_at <= ?
  `).all(nowIso);

  let count = 0;
  for (const row of rows) {
    const result = releaseHoldForOrder(row.id);
    if (result.changed) count += 1;
  }
  return count;
}

export function ensureHoldActive(orderId) {
  const order = getOrder(orderId);
  if (!order) return null;
  if (
    order.status === 'reserved'
    && order.hold_expires_at
    && Date.parse(order.hold_expires_at) <= Date.now()
  ) {
    releaseHoldForOrder(orderId);
    return getOrder(orderId);
  }
  return order;
}

export function listOrdersByStatus(statuses) {
  const placeholders = statuses.map(() => '?').join(',');
  return getDb().prepare(
    `SELECT * FROM orders WHERE status IN (${placeholders}) ORDER BY created_at DESC`,
  ).all(...statuses);
}

export function listAllOrders() {
  return getDb().prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
}

export function transitionOrder(id, fromStatus, toStatus, patch = {}) {
  const current = getOrder(id);
  if (!current) return { changed: false, order: null };
  if (FINAL.has(current.status)) return { changed: false, order: current };

  const sets = ['status = @toStatus', 'updated_at = @updated_at'];
  const params = {
    id,
    fromStatus,
    toStatus,
    updated_at: new Date().toISOString(),
    ...patch,
  };
  if (patch.delivery_code !== undefined) sets.push('delivery_code = @delivery_code');

  const info = getDb().prepare(`
    UPDATE orders SET ${sets.join(', ')}
    WHERE id = @id AND status = @fromStatus
  `).run(params);

  return { changed: info.changes === 1, order: getOrder(id) };
}

export function transitionOrderFromAny(id, fromStatuses, toStatus, patch = {}) {
  for (const from of fromStatuses) {
    const r = transitionOrder(id, from, toStatus, patch);
    if (r.changed) return r;
  }
  return { changed: false, order: getOrder(id) };
}

export function updateOrderAmounts(id, promoCode, discountAmount, finalAmount) {
  getDb().prepare(`
    UPDATE orders SET promo_code = ?, discount_amount = ?, final_amount = ?, updated_at = ?
    WHERE id = ? AND status = 'reserved'
  `).run(promoCode, discountAmount, finalAmount, new Date().toISOString(), id);
  return getOrder(id);
}
