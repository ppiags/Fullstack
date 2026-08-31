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
};

if (!orderId) {
  els.status.textContent = 'ID заказа не указан';
} else {
  els.orderId.textContent = orderId;
  poll();
  setInterval(poll, 2000);
}

async function poll() {
  const res = await fetch(`/api/orders/${orderId}`);
  if (!res.ok) return;
  const order = await res.json();
  render(order);
}

function render(order) {
  els.status.textContent = order.status;
  els.status.className = `status status--${order.status}`;
  els.amounts.textContent = `Сумма: ${order.amount} ₽` +
    (order.discount_amount ? ` → ${order.final_amount} ₽ (скидка ${order.discount_amount} ₽)` : '');

  const isFinal = ['delivered', 'payment_failed'].includes(order.status);
  const canPay = order.status === 'created';
  const canPromo = order.status === 'created' && !order.promo_code;

  els.payActions.hidden = !canPay;
  els.promoSection.hidden = !canPromo;

  if (order.delivery_code) {
    els.codeSection.hidden = false;
    els.deliveryCode.textContent = order.delivery_code;
  }
}

document.getElementById('paySuccess').addEventListener('click', async () => {
  await fetch(`/api/pay/${orderId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ result: 'success' }),
  });
  poll();
});

document.getElementById('payFail').addEventListener('click', async () => {
  await fetch(`/api/pay/${orderId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ result: 'fail' }),
  });
  poll();
});

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
