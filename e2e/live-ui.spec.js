import { test, expect } from "@playwright/test";
import {
  SKU,
  OFFER_ID,
  adminPatch,
  buyCard,
  cardPriceLabel,
  fetchOffers,
  resetDb,
  searchSku,
  soldOutSku,
  uniquePatchPrice,
  watchOrderPosts,
} from "./helpers.js";

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

test("A1 two tabs patch price", async ({ page, context, request }) => {
  await page.goto("/");
  await searchSku(page, SKU);
  const page2 = await context.newPage();
  await page2.goto("/");
  await searchSku(page2, SKU);

  const offers = await fetchOffers(request);
  const nextPrice = uniquePatchPrice(offers);
  const patched = offers.map((o) =>
    o.offerId === OFFER_ID ? { ...o, price: nextPrice } : o,
  );
  const minPrice = Math.min(...patched.map((o) => o.price));
  const expected = cardPriceLabel(minPrice);

  const cardSel = `#productsGrid article.product-card[data-sku="${SKU}"]`;
  const priceSel = `${cardSel} .product-card__price`;
  const beforeText = await page.locator(priceSel).textContent();
  expect(expected).not.toBe(beforeText);

  await adminPatch(request, OFFER_ID, { price: nextPrice });

  await expect(page.locator(priceSel)).toHaveText(expected);
  await expect(page2.locator(priceSel)).toHaveText(expected);
});

test("A2 live stock sold out disables card buy", async ({ page, request }) => {
  await page.goto("/");
  await searchSku(page, SKU);
  const buy = page.locator(
    `#productsGrid article.product-card[data-sku="${SKU}"] .product-card__buy`,
  );
  await expect(buy).toBeVisible();
  await soldOutSku(request, SKU);
  await expect(buy).toHaveText("Нет в наличии");
  await expect(buy).toBeDisabled();
});

test("A8 two tabs last unit sold out banner", async ({ browser, request }) => {
  const sel = `#productsGrid article.product-card[data-sku="${SKU}"] .product-card__buy`;
  const c1 = await browser.newContext();
  const c2 = await browser.newContext();
  const p1 = await c1.newPage();
  const p2 = await c2.newPage();
  try {
    await Promise.all([p1.goto(`/?q=${SKU}`), p2.goto(`/?q=${SKU}`)]);
    await p1.locator(sel).waitFor({ state: "visible" });
    await p2.locator(sel).waitFor({ state: "visible" });
    await expect(p1.locator(sel)).toHaveAttribute("data-offer-id", OFFER_ID);
    await expect(p2.locator(sel)).toHaveAttribute("data-offer-id", OFFER_ID);

    const waitPost = (page) =>
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/orders") && r.request().method() === "POST",
      );
    await Promise.all([
      waitPost(p1),
      waitPost(p2),
      p1.evaluate((s) => document.querySelector(s)?.click(), sel),
      p2.evaluate((s) => document.querySelector(s)?.click(), sel),
    ]);

    await Promise.race([
      p1.waitForURL(/order\.html\?id=/, { timeout: 8000 }),
      p2.waitForURL(/order\.html\?id=/, { timeout: 8000 }),
    ]);

    const pages = [p1, p2];
    const winner = pages.find((p) => /order\.html/.test(p.url()));
    const loser = pages.find((p) => p !== winner);
    expect(winner).toBeTruthy();
    expect(loser).toBeTruthy();
    expect(/order\.html/.test(loser.url())).toBeFalsy();

    const orderId = new URL(winner.url()).searchParams.get("id");
    const orderRes = await request.get(`/api/orders/${orderId}`);
    expect(orderRes.ok()).toBeTruthy();
    const order = await orderRes.json();
    expect(order.status).toBe("reserved");
    expect(order.offer_id).toBe(OFFER_ID);

    await expect(loser.locator("#soldOutBanner")).toBeVisible();
    await expect(loser.locator(".sf-sold-out__message")).toHaveText(
      "Товар только что раскупили",
    );
    expect(await loser.locator(".sf-sold-out__alt").count()).toBeGreaterThan(0);
  } finally {
    await c1.close();
    await c2.close();
  }
});

test("A3 storefront reconnect refetches catalog", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3100",
  });
  /** @type {import("@playwright/test").WebSocketRoute | undefined} */
  let wsRoute;
  await context.routeWebSocket(/\/ws$/, (ws) => {
    wsRoute = ws;
    ws.connectToServer();
  });
  const page = await context.newPage();
  try {
    const wsPromise = page.waitForEvent("websocket");
    let catalogGets = 0;
    page.on("response", (res) => {
      if (!res.ok() || !res.url().includes("/api/catalog?")) return;
      if (new URL(res.url()).searchParams.get("q") === SKU) catalogGets += 1;
    });
    await page.goto("/");
    await searchSku(page, SKU);
    const socket = await wsPromise;
    await expect(
      page.locator(`#productsGrid article.product-card[data-sku="${SKU}"]`),
    ).toBeVisible();
    expect(catalogGets).toBeGreaterThanOrEqual(1);
    const firstGets = catalogGets;

    await context.setOffline(true);
    expect(wsRoute).toBeTruthy();
    await wsRoute.close();
    await socket.waitForEvent("close", { timeout: 15_000 });
    await context.setOffline(false);

    await expect
      .poll(() => catalogGets, { timeout: 15_000 })
      .toBeGreaterThan(firstGets);
    const card = page.locator(
      `#productsGrid article.product-card[data-sku="${SKU}"]`,
    );
    await expect(card).toBeVisible();
    await expect(card.locator(".product-card__buy")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("A4 sticky buy same order no second POST", async ({ page }) => {
  const posts = watchOrderPosts(page);
  await buyCard(page, SKU);
  const id = new URL(page.url()).searchParams.get("id");
  expect(id).toBeTruthy();
  expect(posts).toHaveLength(1);

  await page.goto("/");
  await searchSku(page, SKU);
  const buy = page.locator(
    `#productsGrid article.product-card[data-sku="${SKU}"] .product-card__buy`,
  );
  await expect(buy).toBeVisible();
  const stored = await page.evaluate(
    (offerId) => sessionStorage.getItem(`order:${offerId}`),
    OFFER_ID,
  );
  expect(stored).toBe(id);

  const offerId = await buy.getAttribute("data-offer-id");
  if (offerId === OFFER_ID) {
    await buy.click();
    await page.waitForURL(/order\.html\?id=/);
    expect(new URL(page.url()).searchParams.get("id")).toBe(id);
    expect(posts).toHaveLength(1);
  } else {
    await buy.click();
    await page.waitForURL(/order\.html\?id=/);
    expect(new URL(page.url()).searchParams.get("id")).not.toBe(id);
    expect(posts.length).toBeGreaterThanOrEqual(2);
  }
});

test("A6 deep link q without type finds key", async ({ page }) => {
  await page.goto(`/?q=${SKU}`);
  await expect(
    page.locator(`#productsGrid article.product-card[data-sku="${SKU}"]`),
  ).toBeVisible();
});

test("A7 checkout price updates before pay", async ({ page, request }) => {
  await buyCard(page, SKU);
  const orderId = new URL(page.url()).searchParams.get("id");
  const orderRes = await request.get(`/api/orders/${orderId}`);
  const order = await orderRes.json();
  const nextPrice = order.amount + 17;
  await adminPatch(request, order.offer_id, { price: nextPrice });
  await expect(page.locator("#amounts")).toContainText(String(nextPrice), {
    timeout: 3000,
  });
  await expect(page.locator("#priceUpdatedMsg")).toBeVisible();
});

test("A5 hold expire then new order POST", async ({ page, request }) => {
  const posts = watchOrderPosts(page);
  await buyCard(page, SKU);
  const firstId = new URL(page.url()).searchParams.get("id");
  expect(firstId).toBeTruthy();
  const orderRes = await request.get(`/api/orders/${firstId}`);
  expect(orderRes.ok()).toBeTruthy();
  const order = await orderRes.json();
  const holdRemainingMs =
    Date.parse(order.hold_expires_at) - Date.parse(order.serverNow);
  expect(holdRemainingMs).toBeLessThan(10_000);
  await expect(page.locator("#holdTimer")).toBeVisible();
  await expect(page.locator("#holdExpiredSection")).toBeVisible();
  await page.goto("/");
  await searchSku(page, SKU);
  const buy = page.locator(
    `#productsGrid article.product-card[data-sku="${SKU}"] .product-card__buy`,
  );
  await expect(buy).toBeEnabled();
  await expect(buy).toHaveAttribute("data-offer-id", OFFER_ID);
  await buy.click();
  await page.waitForURL(/order\.html\?id=/);
  const secondId = new URL(page.url()).searchParams.get("id");
  expect(secondId).not.toBe(firstId);
  expect(posts.length).toBeGreaterThanOrEqual(2);
});
