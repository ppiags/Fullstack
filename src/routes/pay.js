import { Router } from 'express';
import { simulatePayment } from '../mocks/paymentStub.js';
import { ensureHoldActive, getOrder } from '../services/orderService.js';

const router = Router();

router.post('/:orderId', async (req, res) => {
  const orderId = req.params.orderId;
  let order = getOrder(orderId);
  if (!order) return res.status(404).json({ error: 'NOT_FOUND' });

  if (['paid', 'delivering', 'delivered'].includes(order.status)) {
    return res.json({ ok: true, order: getOrder(orderId) });
  }

  order = ensureHoldActive(orderId);
  if (!order) return res.status(404).json({ error: 'NOT_FOUND' });

  if (order.status === 'hold_expired') {
    return res.status(409).json({ error: 'HOLD_EXPIRED' });
  }

  if (order.status !== 'reserved') {
    return res.status(400).json({ error: 'INVALID_ORDER_STATE' });
  }

  const result = req.body?.result === 'fail' ? 'fail' : 'success';
  const payload = await simulatePayment(orderId, result);
  res.json({ ok: true, webhook: payload, order: getOrder(orderId) });
});

export default router;
