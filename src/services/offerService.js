import { getDb } from '../db/connection.js';
import { calcDiscount, getPromo } from './promoService.js';
import { broadcast } from './wsHub.js';

function nowIso() {
  return new Date().toISOString();
}

function makeError(code, message = code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function productBuyFields(db, sku) {
  const row = db.prepare(`
    SELECT id AS buyOfferId, stock_available AS buyStockAvailable
    FROM offers
    WHERE product_sku = ?
    ORDER BY CASE WHEN stock_available > 0 THEN 0 ELSE 1 END, price ASC, id ASC
    LIMIT 1
  `).get(sku);
  return {
    buyOfferId: row?.buyOfferId ?? null,
    buyStockAvailable: row?.buyStockAvailable ?? 0,
  };
}

export function emitOfferUpdated(offer) {
  const sku = offer.product_sku;
  const db = getDb();
  const agg = db.prepare(`
    SELECT MIN(price) AS minPrice, COUNT(*) AS offerCount
    FROM offers
    WHERE product_sku = ?
  `).get(sku);
  const payload = {
    offerId: offer.id,
    sku,
    price: offer.price,
    stockAvailable: offer.stock_available,
    stockReserved: offer.stock_reserved,
    minPrice: agg.minPrice,
    offerCount: agg.offerCount,
    ...productBuyFields(db, sku),
  };
  broadcast('offer.updated', payload);
  if (offer.stock_available === 0) {
    broadcast('offer.sold_out', { offerId: offer.id, sku, stockAvailable: 0 });
  }
}

export function getOffer(offerId) {
  const db = getDb();
  return db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId) ?? null;
}

export function getAdminOfferView(offerId) {
  const offer = getOffer(offerId);
  if (!offer) throw makeError('OFFER_NOT_FOUND');
  const db = getDb();
  const buy = productBuyFields(db, offer.product_sku);
  const buyRow = buy.buyOfferId ? getOffer(buy.buyOfferId) : null;
  const skuOffers = db.prepare(`
    SELECT id AS offerId, price, stock_available AS stockAvailable
    FROM offers
    WHERE product_sku = ?
    ORDER BY id ASC
  `).all(offer.product_sku);
  return {
    offerId: offer.id,
    productSku: offer.product_sku,
    sellerName: offer.seller_name,
    price: offer.price,
    currency: offer.currency,
    stockAvailable: offer.stock_available,
    stockReserved: offer.stock_reserved,
    buyOfferId: buy.buyOfferId,
    buyPrice: buyRow ? buyRow.price : null,
    buyStockAvailable: buy.buyStockAvailable,
    offerCount: skuOffers.length,
    inStockCount: skuOffers.filter((o) => o.stockAvailable > 0).length,
    skuOffers,
  };
}

function escapeLike(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

export function parseCatalogQuery(query = {}) {
  const limitRaw = Number.parseInt(String(query.limit ?? ''), 10);
  const offsetRaw = Number.parseInt(String(query.offset ?? ''), 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 20;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;
  const q = String(query.q ?? '').trim();
  const type = String(query.type ?? '').trim();
  const otherRaw = String(query.other ?? '').toLowerCase();
  const other = type ? false : otherRaw === '1' || otherRaw === 'true';
  const minNum = query.min === '' || query.min == null ? NaN : Number(query.min);
  const maxNum = query.max === '' || query.max == null ? NaN : Number(query.max);
  return {
    limit,
    offset,
    q,
    type,
    other,
    min: Number.isFinite(minNum) ? minNum : null,
    max: Number.isFinite(maxNum) ? maxNum : null,
  };
}

export function listCatalog(rawQuery = {}) {
  const filters = parseCatalogQuery(rawQuery);
  const db = getDb();
  const qLike = filters.q ? `%${escapeLike(filters.q.toLowerCase())}%` : '';
  const otherFlag = filters.other ? 1 : 0;

  const fromWhere = `
    FROM offers o
    JOIN products p ON p.sku = o.product_sku
    WHERE (? = '' OR LOWER(p.name) LIKE ? ESCAPE '\\' OR LOWER(p.sku) LIKE ? ESCAPE '\\')
      AND (? = '' OR p.type = ?)
      AND (? = 0 OR p.type NOT IN ('topup', 'subscription', 'key', 'giftcard'))
      AND (? IS NULL OR o.price >= ?)
      AND (? IS NULL OR o.price <= ?)
  `;
  const filterParams = [
    filters.q, qLike, qLike,
    filters.type, filters.type,
    otherFlag,
    filters.min, filters.min,
    filters.max, filters.max,
  ];

  const totalRow = db.prepare(`
    SELECT COUNT(*) AS total FROM (
      SELECT p.sku ${fromWhere} GROUP BY p.sku
    )
  `).get(...filterParams);

  const products = db.prepare(`
    SELECT
      p.sku AS sku,
      p.name AS name,
      p.type AS type,
      p.currency AS currency,
      MIN(o.price) AS minPrice,
      COUNT(*) AS offerCount
    ${fromWhere}
    GROUP BY p.sku, p.name, p.type, p.currency
    ORDER BY p.sku ASC
    LIMIT ? OFFSET ?
  `).all(...filterParams, filters.limit, filters.offset);

  for (const p of products) {
    const buy = productBuyFields(db, p.sku);
    p.buyOfferId = buy.buyOfferId;
    p.buyStockAvailable = buy.buyStockAvailable;
  }

  return {
    serverNow: nowIso(),
    total: totalRow.total,
    limit: filters.limit,
    offset: filters.offset,
    products,
  };
}

const RACE_OFFER_ID = 'off_race_last';

export function listAdminOffers() {
  return getDb().prepare(`
    SELECT
      o.id AS offerId,
      o.product_sku AS productSku,
      o.seller_name AS sellerName,
      o.price AS price,
      o.currency AS currency,
      o.stock_available AS stockAvailable,
      o.stock_reserved AS stockReserved
    FROM offers o
    ORDER BY CASE WHEN o.id = ? THEN 0 ELSE 1 END, o.product_sku ASC, o.id ASC
  `).all(RACE_OFFER_ID);
}

export function listCatalogOffers(sku) {
  if (!sku) return null;
  const db = getDb();
  const product = db.prepare(
    'SELECT sku, name, type FROM products WHERE sku = ?',
  ).get(sku);
  if (!product) return null;
  const offers = db.prepare(`
    SELECT
      o.id AS offerId,
      o.seller_name AS sellerName,
      o.price AS price,
      o.currency AS currency,
      o.stock_available AS stockAvailable
    FROM offers o
    WHERE o.product_sku = ?
    ORDER BY o.price ASC, o.id ASC
  `).all(sku);
  return {
    serverNow: nowIso(),
    sku: product.sku,
    name: product.name,
    type: product.type,
    offers,
  };
}

export function listAlternatives(sku, excludeOfferId) {
  const db = getDb();
  return db.prepare(`
    SELECT
      o.id AS offerId,
      o.product_sku AS sku,
      p.name,
      p.type,
      o.seller_name AS sellerName,
      o.price,
      o.currency,
      o.stock_available AS stockAvailable
    FROM offers o
    JOIN products p ON p.sku = o.product_sku
    WHERE o.product_sku = ?
      AND o.id != ?
      AND o.stock_available > 0
    ORDER BY o.price ASC
  `).all(sku, excludeOfferId);
}

export function holdOffer(offerId) {
  const db = getDb();
  db.prepare('BEGIN IMMEDIATE').run();
  try {
    const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId);
    if (!offer) {
      throw makeError('OFFER_NOT_FOUND');
    }
    if (offer.stock_available < 1) {
      throw makeError('SOLD_OUT');
    }

    const now = nowIso();
    const result = db.prepare(`
      UPDATE offers SET
        stock_available = stock_available - 1,
        stock_reserved = stock_reserved + 1,
        updated_at = ?
      WHERE id = ? AND stock_available >= 1
    `).run(now, offerId);

    if (result.changes !== 1) {
      throw makeError('SOLD_OUT');
    }

    db.prepare('COMMIT').run();
    const updated = getOffer(offerId);
    emitOfferUpdated(updated);
    return { ok: true, offer: updated };
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }
}

export function releaseHold(offerId) {
  const db = getDb();
  db.prepare('BEGIN IMMEDIATE').run();
  try {
    const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId);
    if (!offer) {
      throw makeError('OFFER_NOT_FOUND');
    }
    if (offer.stock_reserved < 1) {
      db.prepare('COMMIT').run();
      return;
    }

    const now = nowIso();
    db.prepare(`
      UPDATE offers SET
        stock_available = stock_available + 1,
        stock_reserved = stock_reserved - 1,
        updated_at = ?
      WHERE id = ? AND stock_reserved >= 1
    `).run(now, offerId);

    db.prepare('COMMIT').run();
    const updated = getOffer(offerId);
    emitOfferUpdated(updated);
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }
}

export function consumeReserved(offerId) {
  const db = getDb();
  db.prepare('BEGIN IMMEDIATE').run();
  try {
    const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId);
    if (!offer) {
      throw makeError('OFFER_NOT_FOUND');
    }
    if (offer.stock_reserved < 1) {
      db.prepare('COMMIT').run();
      return;
    }

    const now = nowIso();
    db.prepare(`
      UPDATE offers SET
        stock_reserved = stock_reserved - 1,
        updated_at = ?
      WHERE id = ? AND stock_reserved >= 1
    `).run(now, offerId);

    db.prepare('COMMIT').run();
    const updated = getOffer(offerId);
    emitOfferUpdated(updated);
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }
}

function updateReservedOrdersPrice(offerId, newPrice) {
  const db = getDb();
  const orders = db.prepare(`
    SELECT id, promo_code FROM orders
    WHERE offer_id = ? AND status = 'reserved'
  `).all(offerId);

  if (orders.length === 0) return;

  const now = nowIso();
  const updateOrder = db.prepare(`
    UPDATE orders SET amount = ?, discount_amount = ?, final_amount = ?, updated_at = ?
    WHERE id = ? AND status = 'reserved'
  `);
  const updateRedemption = db.prepare(`
    UPDATE promo_redemptions SET discount_amount = ? WHERE order_id = ?
  `);

  for (const order of orders) {
    let discount = 0;
    let finalAmount = newPrice;
    if (order.promo_code) {
      const promo = getPromo(order.promo_code);
      if (promo) {
        discount = calcDiscount(promo, newPrice);
        finalAmount = newPrice - discount;
        updateRedemption.run(discount, order.id);
      }
    }
    updateOrder.run(newPrice, discount, finalAmount, now, order.id);
  }
}

export function patchOffer(offerId, { price, stockAvailable } = {}) {
  const db = getDb();
  const offer = getOffer(offerId);
  if (!offer) {
    throw makeError('OFFER_NOT_FOUND');
  }

  if (price !== undefined) {
    if (!Number.isSafeInteger(price) || price < 0) {
      throw makeError('INVALID_PRICE');
    }
  }
  if (stockAvailable !== undefined) {
    if (!Number.isSafeInteger(stockAvailable) || stockAvailable < 0) {
      throw makeError('INVALID_STOCK');
    }
  }

  const updates = [];
  const params = [];

  if (price !== undefined) {
    updates.push('price = ?');
    params.push(price);
  }
  if (stockAvailable !== undefined) {
    updates.push('stock_available = ?');
    params.push(stockAvailable);
  }

  if (updates.length === 0) {
    return offer;
  }

  updates.push('updated_at = ?');
  params.push(nowIso());
  params.push(offerId);

  db.prepare('BEGIN IMMEDIATE').run();
  try {
    db.prepare(`UPDATE offers SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    if (price !== undefined) {
      updateReservedOrdersPrice(offerId, price);
    }
    db.prepare('COMMIT').run();
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }

  const updated = getOffer(offerId);
  emitOfferUpdated(updated);
  return updated;
}
