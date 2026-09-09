const params = new URLSearchParams(location.search);
const orderId = params.get('id');

const els = {
  orderId: document.getElementById('orderId'),
  status: document.getElementById('status'),
  amounts: document.getElementById('amounts'),
  codeSection: document.getElementById('codeSection'),
  deliveryCode: document.getElementById('deliveryCode'),
  payActions: document.getElementById('payActions'),
  promoSection: document.getElementById('promoSection'),
  promoInput: document.getElementById('promoInput'),
  applyPromoBtn: document.getElementById('applyPromoBtn'),
  promoMsg: document.getElementById('promoMsg'),
  holdCountdown: document.getElementById('holdCountdown'),
  holdTimer: document.getElementById('holdTimer'),
  holdExpiredSection: document.getElementById('holdExpiredSection'),
  priceUpdatedMsg: document.getElementById('priceUpdatedMsg'),
  paySuccess: document.getElementById('paySuccess'),
  payFail: document.getElementById('payFail'),
};

let clockSkew = 0;
let lastShownAmount = null;
let payInFlight = false;
let countdownInterval = null;
let pollTimer = null;
let currentOrder = null;
let ws = null;
let wsReconnectDelay = 1000;
let wsReconnectTimer = null;

const STATUS_LABELS = {
  reserved: 'забронирован',
  hold_expired: 'бронь снята',
  paid: 'оплачен',
  delivering: 'выдача',
  delivered: 'доставлен',
  payment_failed: 'оплата не прошла',
  out_of_stock: 'нет в наличии',
  delivery_failed: 'ошибка выдачи',
};

const TERMINAL = new Set([
  'delivered',
  'payment_failed',
  'out_of_stock',
  'delivery_failed',
  'hold_expired',
]);

function syncClock(serverNowIso, clientReceivedAt) {
  clockSkew = clientReceivedAt - Date.parse(serverNowIso);
}

function remainingMsFromSkew(order) {
  return Date.parse(order.hold_expires_at) - (Date.now() - clockSkew);
}

function formatCountdown(ms) {
  if (ms <= 0) return '0:00';
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function clearCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function tickCountdown() {
  if (!currentOrder || currentOrder.status !== 'reserved' || !currentOrder.hold_expires_at) {
    clearCountdown();
    return;
  }
  const ms = remainingMsFromSkew(currentOrder);
  els.holdTimer.textContent = formatCountdown(ms);
  if (ms <= 0) {
    clearCountdown();
    poll();
  }
}

function startCountdown() {
  tickCountdown();
  if (!countdownInterval) {
    countdownInterval = setInterval(tickCountdown, 1000);
  }
}

function updatePayButtons() {
  const canPay = currentOrder?.status === 'reserved' && !payInFlight;
  els.paySuccess.disabled = !canPay;
  els.payFail.disabled = !canPay;
}

function startPollInterval(ms) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(poll, ms);
}

function handleWsMessage(event) {
  let msg;
  try {
    msg = JSON.parse(event.data);
  } catch {
    return;
  }
  if (msg.type === 'order.hold_expired' && msg.orderId === orderId) {
    poll();
    return;
  }
  if (msg.type === 'offer.updated' && currentOrder && msg.offerId === currentOrder.offer_id) {
    poll();
  }
}

function connectWs() {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  if (ws) {
    ws.onclose = null;
    ws.close();
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.onmessage = handleWsMessage;
  ws.onclose = () => {
    wsReconnectTimer = setTimeout(() => {
      poll();
      connectWs();
      wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
    }, wsReconnectDelay);
  };
  ws.onopen = () => {
    wsReconnectDelay = 1000;
  };
}

if (!orderId) {
  els.status.textContent = 'ID заказа не указан';
} else {
  els.orderId.textContent = orderId;
  connectWs();
  poll();
  startPollInterval(2000);
}

async function poll() {
  const res = await fetch(`/api/orders/${orderId}`);
  if (!res.ok) return;
  const order = await res.json();
  const clientReceivedAt = Date.now();
  if (order.serverNow) {
    syncClock(order.serverNow, clientReceivedAt);
  }
  render(order);
}

function render(order) {
  currentOrder = order;

  const label = STATUS_LABELS[order.status] ?? order.status;
  els.status.textContent = label;
  els.status.className = `status status--${order.status}`;

  els.amounts.textContent = `Сумма: ${order.amount} ₽` +
    (order.discount_amount ? ` → ${order.final_amount} ₽ (скидка ${order.discount_amount} ₽)` : '');

  const canPay = order.status === 'reserved';
  const canPromo = order.status === 'reserved' && !order.promo_code;
  const isHoldExpired = order.status === 'hold_expired';

  if (canPay) {
    if (lastShownAmount !== null && lastShownAmount !== order.amount) {
      els.priceUpdatedMsg.hidden = false;
    }
    lastShownAmount = order.amount;
  } else {
    els.priceUpdatedMsg.hidden = true;
  }

  els.payActions.hidden = !canPay;
  els.promoSection.hidden = !canPromo;
  els.holdExpiredSection.hidden = !isHoldExpired;
  els.holdCountdown.hidden = !canPay;

  if (canPay && order.hold_expires_at) {
    startCountdown();
  } else {
    clearCountdown();
  }

  updatePayButtons();

  if (order.delivery_code) {
    els.codeSection.hidden = false;
    els.deliveryCode.textContent = order.delivery_code;
  }
}

async function handlePay(result) {
  if (payInFlight || currentOrder?.status !== 'reserved') return;
  payInFlight = true;
  updatePayButtons();
  try {
    await fetch(`/api/pay/${orderId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result }),
    });
  } finally {
    payInFlight = false;
    updatePayButtons();
    poll();
    startPollInterval(200);
    const started = Date.now();
    const tight = setInterval(async () => {
      if (TERMINAL.has(currentOrder?.status) || Date.now() - started > 5000) {
        clearInterval(tight);
        startPollInterval(2000);
        return;
      }
      await poll();
    }, 200);
  }
}

els.paySuccess.addEventListener('click', () => handlePay('success'));
els.payFail.addEventListener('click', () => handlePay('fail'));

els.applyPromoBtn.addEventListener('click', async () => {
  const code = els.promoInput.value.trim();
  if (!code) return;
  const res = await fetch(`/api/orders/${orderId}/apply-promo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await res.json();
  if (!res.ok) {
    els.promoMsg.textContent = `Ошибка: ${data.error}`;
    return;
  }
  els.promoMsg.textContent = `Промокод применён. Итого: ${data.final_amount} ₽`;
  poll();
});
