const TOKEN_KEY = 'admin_token';

const STATUS_LABELS = {
  all: 'Все',
  reserved: 'Забронирован',
  unfulfilled: 'Оплачен, не выдан',
  paid: 'Оплачен',
  delivering: 'Выдаётся',
  delivered: 'Выдан',
  out_of_stock: 'Нет в наличии',
  delivery_failed: 'Ошибка выдачи',
  payment_failed: 'Оплата не прошла',
};

const UNFULFILLED_QUERY = 'paid,delivering,out_of_stock,delivery_failed';

let currentStatus = 'all';

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || 'dev-admin-token';
}

function ordersUrl() {
  if (currentStatus === 'all') return '/api/admin/orders';
  if (currentStatus === 'unfulfilled') {
    return `/api/admin/orders?status=${encodeURIComponent(UNFULFILLED_QUERY)}`;
  }
  return `/api/admin/orders?status=${encodeURIComponent(currentStatus)}`;
}

function canRetry(status) {
  return status === 'out_of_stock' || status === 'delivery_failed';
}

function emptyMessage() {
  if (currentStatus === 'all') return 'Нет заказов';
  if (currentStatus === 'unfulfilled') return 'Нет заказов: оплачен, не выдан';
  return `Нет заказов со статусом ${STATUS_LABELS[currentStatus]}`;
}

function setActiveFilter(status) {
  document.querySelectorAll('#orderFilters .admin-filter').forEach((btn) => {
    btn.classList.toggle('admin-filter--active', btn.dataset.status === status);
  });
}

document.getElementById('tokenInput').value = getToken();
document.getElementById('saveToken').addEventListener('click', () => {
  localStorage.setItem(TOKEN_KEY, document.getElementById('tokenInput').value);
  loadOrders();
});

document.getElementById('refreshBtn').addEventListener('click', loadOrders);

function parseSafeInt(raw) {
  if (raw === '') return undefined;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

function formatOfferStatus(view, saved) {
  const head = saved ? 'Сохранено' : 'Черновик';
  const line1 = `${head} ${view.offerId} · цена ${String(view.price)} · остаток ${view.stockAvailable}`;
  const line2 = `SKU ${view.productSku} · offers ${view.offerCount} · in-stock ${view.inStockCount}`;
  if (view.buyStockAvailable === 0) {
    return `${line1}\n${line2}\nкарточка: нет в наличии`;
  }
  let line3 = `карточка купит ${view.buyOfferId} @ ${String(view.buyPrice)}`;
  if (view.offerId !== view.buyOfferId) {
    line3 += ' · этот offer не buyOfferId';
  }
  return `${line1}\n${line2}\n${line3}`;
}

function fillOfferForm(view) {
  document.getElementById('offerIdInput').value = view.offerId;
  document.getElementById('offerPriceInput').value = String(view.price);
  document.getElementById('offerStockInput').value = String(view.stockAvailable);
}

async function adminFetchOffer(offerId) {
  return fetch(`/api/admin/offers/${encodeURIComponent(offerId)}`, {
    headers: { 'X-Admin-Token': getToken() },
  });
}

async function adminPatchOffer(offerId, body) {
  return fetch(`/api/admin/offers/${encodeURIComponent(offerId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': getToken(),
    },
    body: JSON.stringify(body),
  });
}

function makeBuyPayload(view, offerId) {
  const current = view.skuOffers.find((o) => o.offerId === offerId);
  const others = view.skuOffers.filter(
    (o) => o.offerId !== offerId && o.stockAvailable > 0,
  );
  const minOthers = others.length ? Math.min(...others.map((o) => o.price)) : 0;
  const price = minOthers === 0 ? 0 : minOthers - 1;
  return { price, stockAvailable: Math.max(current.stockAvailable, 1) };
}

function requireOfferId(statusEl) {
  const offerId = document.getElementById('offerIdInput').value.trim();
  if (!offerId) {
    statusEl.textContent = 'Укажите Offer ID';
    return null;
  }
  return offerId;
}

async function showView(offerId, saved) {
  const statusEl = document.getElementById('offerStatus');
  const res = await adminFetchOffer(offerId);
  if (!res.ok) {
    statusEl.textContent = `Ошибка: ${res.status}`;
    return null;
  }
  const view = await res.json();
  fillOfferForm(view);
  statusEl.textContent = formatOfferStatus(view, saved);
  return view;
}

document.getElementById('saveOfferBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('offerStatus');
  const offerId = requireOfferId(statusEl);
  if (!offerId) return;
  const price = parseSafeInt(document.getElementById('offerPriceInput').value);
  const stock = parseSafeInt(document.getElementById('offerStockInput').value);
  if (price === null) {
    statusEl.textContent = 'Ошибка: INVALID_PRICE';
    return;
  }
  if (stock === null) {
    statusEl.textContent = 'Ошибка: INVALID_STOCK';
    return;
  }
  const body = {};
  if (price !== undefined) body.price = price;
  if (stock !== undefined) body.stockAvailable = stock;
  if (!Object.keys(body).length) {
    statusEl.textContent = 'Укажите цену или остаток';
    return;
  }
  statusEl.textContent = 'Сохранение…';
  const res = await adminPatchOffer(offerId, body);
  if (!res.ok) {
    statusEl.textContent = `Ошибка: ${res.status}`;
    return;
  }
  const view = await res.json();
  fillOfferForm(view);
  statusEl.textContent = formatOfferStatus(view, true);
});

document.getElementById('orderFilters').addEventListener('click', (e) => {
  const btn = e.target.closest('.admin-filter');
  if (!btn) return;
  currentStatus = btn.dataset.status;
  setActiveFilter(currentStatus);
  loadOrders();
});

async function loadOrders() {
  const res = await fetch(ordersUrl(), {
    headers: { 'X-Admin-Token': getToken() },
  });
  if (!res.ok) {
    document.getElementById('ordersBody').innerHTML =
      `<tr><td colspan="6">Ошибка: ${res.status}</td></tr>`;
    return;
  }
  const { orders } = await res.json();
  const tbody = document.getElementById('ordersBody');
  tbody.innerHTML = orders.map((o) => `
    <tr>
      <td>${o.id}</td>
      <td>${o.sku}</td>
      <td>${o.status}</td>
      <td>${o.final_amount} ₽</td>
      <td>${o.delivery_code || '—'}</td>
      <td>${canRetry(o.status)
    ? `<button type="button" class="btn btn--primary btn--sm btn-retry" data-id="${o.id}">Retry</button>`
    : ''}</td>
    </tr>
  `).join('') || `<tr><td colspan="6">${emptyMessage()}</td></tr>`;

  tbody.querySelectorAll('.btn-retry').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await fetch(`/api/admin/orders/${btn.dataset.id}/retry`, {
        method: 'POST',
        headers: { 'X-Admin-Token': getToken() },
      });
      loadOrders();
    });
  });
}

loadOrders();

let cachedOffers = [];

function offerRowMatches(offer, q) {
  if (!q) return true;
  const hay = `${offer.offerId} ${offer.productSku} ${offer.sellerName}`.toLowerCase();
  return hay.includes(q);
}

function renderOffers(filter = '') {
  const q = filter.trim().toLowerCase();
  const rows = cachedOffers.filter((o) => offerRowMatches(o, q));
  const tbody = document.getElementById('offersBody');
  tbody.innerHTML = rows.map((o) => `
    <tr class="${o.offerId === 'off_race_last' ? 'admin-offer-row--race' : ''}"
        data-offer-id="${o.offerId}"
        data-price="${o.price}"
        data-stock="${o.stockAvailable}">
      <td>${o.offerId}</td>
      <td>${o.productSku}</td>
      <td>${o.sellerName}</td>
      <td>${o.price} ₽</td>
      <td>${o.stockAvailable}</td>
      <td>${o.stockReserved}</td>
    </tr>
  `).join('') || '<tr><td colspan="6">Нет offers</td></tr>';
}

function setOffersModalOpen(open) {
  document.getElementById('offersModal').hidden = !open;
}

async function loadOffers() {
  const res = await fetch('/api/admin/offers', {
    headers: { 'X-Admin-Token': getToken() },
  });
  if (!res.ok) {
    document.getElementById('offersBody').innerHTML =
      `<tr><td colspan="6">Ошибка: ${res.status}</td></tr>`;
    return;
  }
  const { offers } = await res.json();
  cachedOffers = offers;
  renderOffers(document.getElementById('offersSearch').value);
}

document.getElementById('openOffersBtn').addEventListener('click', async () => {
  setOffersModalOpen(true);
  await loadOffers();
});

document.getElementById('closeOffersBtn').addEventListener('click', () => {
  setOffersModalOpen(false);
});

document.getElementById('offersModal').addEventListener('click', (e) => {
  if (e.target.id === 'offersModal') setOffersModalOpen(false);
});

document.getElementById('offersSearch').addEventListener('input', (e) => {
  renderOffers(e.target.value);
});

document.getElementById('offersBody').addEventListener('click', async (e) => {
  const row = e.target.closest('tr[data-offer-id]');
  if (!row) return;
  setOffersModalOpen(false);
  await showView(row.dataset.offerId, false);
});

// Обнулить SKU
document.getElementById('soldOutSkuBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('offerStatus');
  const offerId = requireOfferId(statusEl);
  if (!offerId) return;
  const resView = await adminFetchOffer(offerId);
  if (!resView.ok) {
    statusEl.textContent = `Ошибка: ${resView.status}`;
    return;
  }
  const view = await resView.json();
  for (const o of view.skuOffers) {
    const res = await adminPatchOffer(o.offerId, { stockAvailable: 0 });
    if (!res.ok) {
      statusEl.textContent = `Ошибка: ${res.status}`;
      return;
    }
  }
  await showView(offerId, true);
});

// Карточка купит этот
document.getElementById('makeBuyOfferBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('offerStatus');
  const offerId = requireOfferId(statusEl);
  if (!offerId) return;
  const resView = await adminFetchOffer(offerId);
  if (!resView.ok) {
    statusEl.textContent = `Ошибка: ${resView.status}`;
    return;
  }
  const view = await resView.json();
  if (!view.skuOffers.find((o) => o.offerId === offerId)) {
    statusEl.textContent = 'Ошибка: 404';
    return;
  }
  const res = await adminPatchOffer(offerId, makeBuyPayload(view, offerId));
  if (!res.ok) {
    statusEl.textContent = `Ошибка: ${res.status}`;
    return;
  }
  const saved = await res.json();
  fillOfferForm(saved);
  statusEl.textContent = formatOfferStatus(saved, true);
});
