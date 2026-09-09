import { getDb } from '../db/connection.js';

export function claimKey(orderId, offerId) {
  const db = getDb();
  return db.transaction(() => {
    if (!offerId) return { ok: false, reason: 'offer_required' };

    const existing = db.prepare(
      `SELECT code FROM keys WHERE order_id = ? AND status = 'assigned'`,
    ).get(orderId);
    if (existing) return { ok: true, code: existing.code };

    const info = db.prepare(`
      UPDATE keys
      SET status = 'assigned', order_id = ?, assigned_at = datetime('now')
      WHERE rowid = (
        SELECT rowid FROM keys WHERE status = 'available' AND offer_id = ? LIMIT 1
      ) AND status = 'available'
    `).run(orderId, offerId);

    if (info.changes !== 1) return { ok: false, reason: 'out_of_stock' };
    const row = db.prepare(`SELECT code FROM keys WHERE order_id = ?`).get(orderId);
    return { ok: true, code: row.code };
  })();
}

export function getKeyByOrderId(orderId) {
  const row = getDb().prepare(
    `SELECT code FROM keys WHERE order_id = ? AND status = 'assigned'`,
  ).get(orderId);
  return row?.code ?? null;
}

export function markAllKeysAssigned() {
  getDb().prepare(`UPDATE keys SET status = 'assigned' WHERE status = 'available'`).run();
}

/** Возвращает ключи, «заблокированные» drain-keys (assigned без order_id), обратно в пул */
export function replenishKeys(count = 1, offerId = null) {
  const offerClause = offerId ? 'AND offer_id = ?' : '';
  const params = offerId ? [offerId, count] : [count];
  const info = getDb().prepare(`
    UPDATE keys
    SET status = 'available', order_id = NULL, assigned_at = NULL
    WHERE rowid IN (
      SELECT rowid FROM keys
      WHERE status = 'assigned' AND order_id IS NULL ${offerClause}
      LIMIT ?
    )
  `).run(...params);
  return info.changes;
}
