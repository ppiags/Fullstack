import { claimKey } from '../services/keyPoolService.js';
import { getOrder } from '../services/orderService.js';

const issuedCodes = new Map();

function envRate(name, fallback) {
  const v = parseFloat(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

function envMs(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : fallback;
}

function shouldFail(errorRate) {
  return Math.random() < errorRate;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function issueFromSupplier({
  supplierName,
  errorRate,
  timeoutMs,
  request_id,
  order_id,
  offer_id: offerId,
}) {
  const hangMs = envMs(
    supplierName === 'A' ? 'SUPPLIER_A_HANG_MS' : 'SUPPLIER_B_HANG_MS',
    0,
  );
  if (hangMs > 0) await delay(hangMs);

  if (issuedCodes.has(request_id)) {
    return { ok: true, code: issuedCodes.get(request_id), supplier: supplierName };
  }

  if (shouldFail(errorRate)) {
    if (Math.random() < 0.5) {
      await delay(timeoutMs + 100);
      return { ok: false, reason: 'timeout', supplier: supplierName };
    }
    return { ok: false, reason: 'supplier_error', supplier: supplierName };
  }

  const claim = claimKey(order_id, offerId);
  if (!claim.ok) return { ok: false, reason: 'out_of_stock', supplier: supplierName };

  issuedCodes.set(request_id, claim.code);
  return { ok: true, code: claim.code, supplier: supplierName };
}

export async function issueFromSupplierA(params) {
  return issueFromSupplier({
    supplierName: 'A',
    errorRate: envRate('SUPPLIER_A_ERROR_RATE', 0),
    timeoutMs: envMs('SUPPLIER_A_TIMEOUT_MS', 5000),
    ...params,
  });
}

export async function issueFromSupplierB(params) {
  return issueFromSupplier({
    supplierName: 'B',
    errorRate: envRate('SUPPLIER_B_ERROR_RATE', 0),
    timeoutMs: envMs('SUPPLIER_B_TIMEOUT_MS', 3000),
    ...params,
  });
}

export function resetSupplierMocks() {
  issuedCodes.clear();
}
