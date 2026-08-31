import { Router } from 'express';
import { issueFromSupplierA, issueFromSupplierB } from '../mocks/supplierMocks.js';

function createSupplierRouter(issueFn, supplierName) {
  const router = Router();

  router.post('/issue', async (req, res) => {
    const { request_id, sku, order_id } = req.body ?? {};
    if (!request_id || !sku || !order_id) {
      return res.status(400).json({ status: 'error', reason: 'invalid_request' });
    }

    const result = await issueFn({ request_id, sku, order_id });
    if (result.ok) {
      return res.json({ status: 'ok', request_id, code: result.code });
    }
    if (result.reason === 'out_of_stock') {
      return res.status(409).json({ status: 'error', reason: 'out_of_stock' });
    }
    if (result.reason === 'timeout') {
      return res.status(504).json({ status: 'error', reason: 'timeout' });
    }
    return res.status(503).json({ status: 'error', reason: result.reason ?? 'supplier_error' });
  });

  router.get('/health', (_req, res) => {
    res.json({ ok: true, supplier: supplierName });
  });

  return router;
}

export const supplierARouter = createSupplierRouter(issueFromSupplierA, 'A');
export const supplierBRouter = createSupplierRouter(issueFromSupplierB, 'B');
