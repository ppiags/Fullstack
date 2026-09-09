import { getDb } from '../db/connection.js';
import { getOrder, updateOrderAmounts } from './orderService.js';

export function calcDiscount(promo, amount) {
  if (promo.type === 'percent') return Math.floor((amount * promo.value) / 100);
  return Math.min(promo.value, amount);
}

export function getPromo(code) {
  return getDb().prepare('SELECT * FROM promocodes WHERE code = ?').get(code) ?? null;
}

export function validatePromo(code, sku) {
  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE sku = ?').get(sku);
  if (!product) return { valid: false, error: 'PRODUCT_NOT_FOUND' };

  const promo = getPromo(code);
  if (!promo) return { valid: false, error: 'NOT_FOUND' };
  if (promo.used_count >= promo.max_uses) return { valid: false, error: 'LIMIT_REACHED' };

  const discount = calcDiscount(promo, product.price);
  return {
    valid: true,
    code: promo.code,
    discount,
    final_amount: product.price - discount,
  };
}

export function applyPromoToOrder(orderId, code) {
  const db = getDb();
  return db.transaction(() => {
    const order = getOrder(orderId);
    if (!order || order.status !== 'reserved') return { ok: false, error: 'INVALID_ORDER_STATE' };
    if (order.promo_code) return { ok: false, error: 'PROMO_ALREADY_APPLIED' };

    const promo = getPromo(code);
    if (!promo) return { ok: false, error: 'NOT_FOUND' };

    const info = db.prepare(`
      UPDATE promocodes SET used_count = used_count + 1
      WHERE code = ? AND used_count < max_uses
    `).run(code);
    if (info.changes !== 1) return { ok: false, error: 'LIMIT_REACHED' };

    const discount = calcDiscount(promo, order.amount);
    const finalAmount = order.amount - discount;

    db.prepare(`
      INSERT INTO promo_redemptions (code, order_id, discount_amount, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(code, orderId, discount);

    const updated = updateOrderAmounts(orderId, code, discount, finalAmount);
    return { ok: true, order: updated };
  })();
}

export function getPromoUsedCount(code) {
  return getDb().prepare('SELECT used_count FROM promocodes WHERE code = ?').get(code)?.used_count ?? 0;
}
