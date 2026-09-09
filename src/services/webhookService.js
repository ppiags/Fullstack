import { getDb } from '../db/connection.js';
import { getOrder, transitionOrder } from './orderService.js';
import { consumeReserved, releaseHold } from './offerService.js';
import { deliver } from './deliveryService.js';

const SKIP_DELIVER = new Set(['delivered', 'payment_failed', 'hold_expired']);

export function scheduleDeliver(orderId) {
  setImmediate(() => {
    deliver(orderId).catch((err) => console.error(err));
  });
}

export function processPaymentWebhook(payload) {
  const db = getDb();
  const { event_id, order_id, status } = payload;

  try {
    db.prepare(`
      INSERT INTO webhook_events (event_id, order_id, payload_status, processed_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(event_id, order_id, status);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      return { duplicate: true, processed: false, needsDeliver: false };
    }
    throw e;
  }

  const order = getOrder(order_id);
  if (!order) {
    db.prepare(`
      INSERT OR REPLACE INTO pending_webhooks (event_id, order_id, payload, received_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(event_id, order_id, JSON.stringify(payload));
    return { duplicate: false, processed: false, pending: true, needsDeliver: false };
  }

  return applyWebhookToOrder(order, payload);
}

function applyWebhookToOrder(order, payload) {
  if (payload.status === 'failed') {
    const current = getOrder(order.id);
    if (current.status === 'reserved') {
      const moved = transitionOrder(order.id, 'reserved', 'payment_failed');
      if (moved.changed && current.offer_id) {
        releaseHold(current.offer_id);
      }
    }
    return { duplicate: false, processed: true, needsDeliver: false, orderId: order.id };
  }

  if (payload.status === 'paid') {
    const current = getOrder(order.id);
    if (current.status === 'reserved') {
      const moved = transitionOrder(order.id, 'reserved', 'paid');
      if (moved.changed && current.offer_id) {
        consumeReserved(current.offer_id);
      }
    }
    const after = getOrder(order.id);
    const needsDeliver = Boolean(after && !SKIP_DELIVER.has(after.status));
    return { duplicate: false, processed: true, needsDeliver, orderId: order.id };
  }

  return { duplicate: false, processed: false, needsDeliver: false, orderId: order.id };
}

export async function applyPendingWebhooksForOrder(orderId) {
  const db = getDb();
  const rows = db.prepare(`SELECT event_id, payload FROM pending_webhooks WHERE order_id = ?`).all(orderId);
  let needsDeliver = false;
  for (const row of rows) {
    const payload = JSON.parse(row.payload);
    const order = getOrder(orderId);
    if (order) {
      const result = applyWebhookToOrder(order, payload);
      if (result.needsDeliver) needsDeliver = true;
    }
    db.prepare(`DELETE FROM pending_webhooks WHERE event_id = ?`).run(row.event_id);
  }
  if (needsDeliver) scheduleDeliver(orderId);
}

export function countWebhookEvents(eventId) {
  return getDb().prepare('SELECT COUNT(*) AS c FROM webhook_events WHERE event_id = ?').get(eventId).c;
}
