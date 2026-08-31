import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/connection.js';

const FINAL = new Set(['delivered', 'payment_failed']);

export function createOrder(sku, forcedId = null, idempotencyKey = null) {
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

    const product = db.prepare('SELECT * FROM products WHERE sku = ?').get(sku);
    if (!product) {
      const err = new Error('PRODUCT_NOT_FOUND');
      err.code = 'PRODUCT_NOT_FOUND';
      throw err;
    }

    const id = forcedId || `ord_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
    const now = new Date().toISOString();
    const order = {
      id,
      sku,
      status: 'created',
      amount: product.price,
      currency: product.currency,
      promo_code: null,
      discount_amount: 0,
      final_amount: product.price,
      delivery_code: null,
      delivery_request_id: id,
      created_at: now,
      updated_at: now,
    };

    db.prepare(`
      INSERT INTO orders (id, sku, status, amount, currency, promo_code, discount_amount,
        final_amount, delivery_code, delivery_request_id, created_at, updated_at)
      VALUES (@id, @sku, @status, @amount, @currency, @promo_code, @discount_amount,
        @final_amount, @delivery_code, @delivery_request_id, @created_at, @updated_at)
    `).run(order);

    if (idempotencyKey) {
      db.prepare(`
        INSERT INTO order_idempotency (idempotency_key, order_id, created_at)
        VALUES (?, ?, ?)
      `).run(idempotencyKey, id, now);
    }

    db.prepare('COMMIT').run();
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

export function listOrdersByStatus(statuses) {
  const placeholders = statuses.map(() => '?').join(',');
  return getDb().prepare(`SELECT * FROM orders WHERE status IN (${placeholders})`).all(...statuses);
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
    WHERE id = ? AND status = 'created'
  `).run(promoCode, discountAmount, finalAmount, new Date().toISOString(), id);
  return getOrder(id);
}
