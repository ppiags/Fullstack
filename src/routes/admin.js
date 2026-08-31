import { Router } from 'express';
import { listOrdersByStatus, listAllOrders } from '../services/orderService.js';
import { deliver } from '../services/deliveryService.js';
import { getOrder } from '../services/orderService.js';

const router = Router();

function requireAdmin(req, res, next) {
  const token = req.header('X-Admin-Token');
  const expected = process.env.ADMIN_TOKEN || 'dev-admin-token';
  if (token !== expected) return res.status(401).json({ error: 'UNAUTHORIZED' });
  next();
}

router.use(requireAdmin);

router.get('/orders', (req, res) => {
  const statusParam = req.query.status;
  if (!statusParam || statusParam === 'all') {
    return res.json({ orders: listAllOrders() });
  }
  const statuses = statusParam.split(',').map((s) => s.trim()).filter(Boolean);
  res.json({ orders: listOrdersByStatus(statuses) });
});

router.post('/orders/:id/retry', async (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'NOT_FOUND' });
  if (!['out_of_stock', 'delivery_failed'].includes(order.status) && order.status !== 'delivered') {
    return res.status(400).json({ error: 'INVALID_STATUS' });
  }
  const result = await deliver(order.id);
  res.json({ order: getOrder(order.id), result });
});

export default router;
