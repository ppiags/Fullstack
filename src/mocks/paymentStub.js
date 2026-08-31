import { getOrder } from '../services/orderService.js';
import { processPaymentWebhook } from '../services/webhookService.js';

export async function simulatePayment(orderId, result, baseUrl = `http://localhost:${process.env.PORT || 3000}`) {
  const order = getOrder(orderId);
  if (!order) throw new Error('ORDER_NOT_FOUND');

  const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    event_id: eventId,
    order_id: orderId,
    status: result === 'success' ? 'paid' : 'failed',
    amount: order.final_amount,
    currency: order.currency,
    created_at: new Date().toISOString(),
  };

  await processPaymentWebhook(payload);
  return payload;
}
