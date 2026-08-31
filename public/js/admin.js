const TOKEN_KEY = 'admin_token';

const STATUS_LABELS = {
  all: 'Все',
  created: 'Создан',
  paid: 'Оплачен',
  delivering: 'Выдаётся',
  delivered: 'Выдан',
  out_of_stock: 'Нет в наличии',
  delivery_failed: 'Ошибка выдачи',
  payment_failed: 'Оплата не прошла',
};

let currentStatus = 'all';

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || 'dev-admin-token';
}

function ordersUrl() {
  if (currentStatus === 'all') return '/api/admin/orders';
  return `/api/admin/orders?status=${encodeURIComponent(currentStatus)}`;
}

function canRetry(status) {
  return status === 'out_of_stock' || status === 'delivery_failed';
}

function emptyMessage() {
  if (currentStatus === 'all') return 'Нет заказов';
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
