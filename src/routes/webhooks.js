import { Router } from 'express';
import { processPaymentWebhook } from '../services/webhookService.js';

const router = Router();

router.post('/payment', async (req, res) => {
  const payload = req.body ?? {};
  if (!payload.event_id || !payload.order_id || !payload.status) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD' });
  }
  await processPaymentWebhook(payload);
  res.status(200).json({ ok: true });
});

export default router;
