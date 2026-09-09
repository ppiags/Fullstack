import { getOrder, transitionOrder, transitionOrderFromAny } from './orderService.js';
import { getKeyByOrderId } from './keyPoolService.js';
import { issueFromSupplierA, issueFromSupplierB } from '../mocks/supplierMocks.js';

export async function deliver(orderId) {
  const order = getOrder(orderId);
  if (!order) return { status: 'delivery_failed' };
  if (order.status === 'delivered') return { status: 'delivered' };

  const existingCode = order.delivery_code || getKeyByOrderId(orderId);
  if (existingCode) {
    transitionOrderFromAny(orderId, ['paid', 'delivering', 'out_of_stock', 'delivery_failed'], 'delivered', {
      delivery_code: existingCode,
    });
    return { status: 'delivered' };
  }

  transitionOrderFromAny(orderId, ['paid', 'out_of_stock', 'delivery_failed'], 'delivering');

  const requestId = order.delivery_request_id || orderId;
  const params = {
    request_id: requestId,
    sku: order.sku,
    order_id: orderId,
    offer_id: order.offer_id,
  };

  let result = await issueFromSupplierA(params);
  if (!result.ok && result.reason !== 'out_of_stock') {
    result = await issueFromSupplierB(params);
  }

  if (result.ok) {
    transitionOrder(orderId, 'delivering', 'delivered', { delivery_code: result.code });
    return { status: 'delivered' };
  }

  if (result.reason === 'out_of_stock') {
    transitionOrder(orderId, 'delivering', 'out_of_stock');
    return { status: 'out_of_stock' };
  }

  transitionOrder(orderId, 'delivering', 'delivery_failed');
  return { status: 'delivery_failed' };
}
