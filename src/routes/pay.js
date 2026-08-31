import { Router } from 'express';
import { simulatePayment } from '../mocks/paymentStub.js';
import { getOrder } from '../services/orderService.js';

const router = Router();

router.post('/:orderId', async (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'NOT_FOUND' });

  const result = req.body?.result === 'fail' ? 'fail' : 'success';
  const payload = await simulatePayment(order.id, result);
  res.json({ ok: true, webhook: payload, order: getOrder(order.id) });
});

export default router;
