import { Router } from 'express';
import { processPaymentWebhook, scheduleDeliver } from '../services/webhookService.js';

const router = Router();

router.post('/payment', (req, res) => {
  const payload = req.body ?? {};
  if (!payload.event_id || !payload.order_id || !payload.status) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD' });
  }
  const result = processPaymentWebhook(payload);
  res.status(200).json({ ok: true });
  if (result.needsDeliver) {
    res.once('finish', () => scheduleDeliver(result.orderId || payload.order_id));
  }
});

export default router;
