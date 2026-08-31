# Магазин цифровых товаров

Тестовое задание fullstack (этапы 1–4): витрина, однократная выдача под гонками, recovery, промокоды.

**ТЗ:** [Google Doc](https://docs.google.com/document/d/1RD9pNfKdf-U4BsD9JFcJ3l2ObfxAwpCr2pGOf9N81z4/edit)

## Запуск

```bash
npm install
npm run seed
npm start
```

Открыть: **http://localhost:3000**

Admin: http://localhost:3000/admin.html — заголовок `X-Admin-Token: dev-admin-token`

## Флоу покупки

1. **Купить** на карточке CS2 Prime (фильтр «Предметы») → `order.html`
2. Опционально промокод (`WELCOME10`, `GG500`, `LIMIT3`, `ONCEONLY`)
3. **Оплатить (успех)** → webhook → автовыдача ключа

## Воспроизведение гонок

**Терминал 1** — сервер с тест-флагом:

```bash
ALLOW_TEST_ORDER_ID=1 npm start
```

**Терминал 2:**

```bash
ALLOW_TEST_ORDER_ID=1 npm run test:races
```

| Скрипт | Сценарий | Критерий ТЗ |
|--------|----------|-------------|
| `race-test-webhook.js` | 50 параллельных webhook → 1 выдача | #1 |
| `race-test-webhook-dedup.js` | Повтор `event_id` | #2 |
| `race-test-webhook-early.js` | Webhook до создания заказа | #3 |
| `race-test-double-buy.js` | 20 параллельных «Купить» с одним `idempotency_key` | доп. |
| `race-test-promo.js` | `LIMIT3` под параллельными запросами | #5 |
| `race-test-out-of-stock.js` | Пустой пул → admin retry → `delivered` | #4 |

## Тесты

```bash
npm test
```
