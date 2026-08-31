import { getDb } from '../db/connection.js';
import { getOrder, transitionOrder } from './orderService.js';
import { deliver } from './deliveryService.js';

export async function processPaymentWebhook(payload) {
  const db = getDb();
  const { event_id, order_id, status } = payload;

  try {
    db.prepare(`
      INSERT INTO webhook_events (event_id, order_id, payload_status, processed_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(event_id, order_id, status);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      return { duplicate: true, processed: false };
    }
    throw e;
  }

  const order = getOrder(order_id);
  if (!order) {
    db.prepare(`
      INSERT OR REPLACE INTO pending_webhooks (event_id, order_id, payload, received_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(event_id, order_id, JSON.stringify(payload));
    return { duplicate: false, processed: false, pending: true };
  }

  return applyWebhookToOrder(order, payload);
}

async function applyWebhookToOrder(order, payload) {
  if (payload.status === 'failed') {
    transitionOrder(order.id, 'created', 'payment_failed');
    return { duplicate: false, processed: true };
  }

  if (payload.status === 'paid') {
    const current = getOrder(order.id);
    if (current.status === 'created') {
      transitionOrder(order.id, 'created', 'paid');
    }
    const after = getOrder(order.id);
    if (after && !['delivered', 'payment_failed'].includes(after.status)) {
      await deliver(order.id);
    }
    return { duplicate: false, processed: true };
  }

  return { duplicate: false, processed: false };
}

export async function applyPendingWebhooksForOrder(orderId) {
  const db = getDb();
  const rows = db.prepare(`SELECT event_id, payload FROM pending_webhooks WHERE order_id = ?`).all(orderId);
  for (const row of rows) {
    const payload = JSON.parse(row.payload);
    const order = getOrder(orderId);
    if (order) await applyWebhookToOrder(order, payload);
    db.prepare(`DELETE FROM pending_webhooks WHERE event_id = ?`).run(row.event_id);
  }
}

export function countWebhookEvents(eventId) {
  return getDb().prepare('SELECT COUNT(*) AS c FROM webhook_events WHERE event_id = ?').get(eventId).c;
}
