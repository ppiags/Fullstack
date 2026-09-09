import { test, expect } from "@playwright/test";
import {
  ADMIN_TOKEN,
  OFFER_ID,
  PROMO_WELCOME10,
  SKU,
  buyCard,
  fetchOffers,
  resetDb,
  searchSku,
  uniquePatchPrice,
} from "./helpers.js";

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

test("B1 search card and load more", async ({ page }) => {
  await page.goto("/");
  await searchSku(page, SKU);
  await expect(
    page.locator(`#productsGrid article.product-card[data-sku="${SKU}"]`),
  ).toBeVisible();

  const qRes = page.waitForResponse(
    (r) => r.ok() && r.url().includes("/api/catalog?"),
  );
  await page.locator("#searchInput").fill("");
  await qRes;

  const itemsRes = page.waitForResponse(
    (r) => r.url().includes("/api/catalog?") && r.ok(),
  );
  await page.locator('#categoryFilters [data-category="items"]').click();
  await itemsRes;

  const grid = page.locator("#productsGrid article.product-card");
  await expect(grid.first()).toBeVisible();
  const before = await grid.count();
  await expect(page.locator("#loadMoreBtn")).toBeVisible();

  const moreRes = page.waitForResponse(
    (r) => r.url().includes("/api/catalog?") && r.ok(),
  );
  await page.locator("#loadMoreBtn").click();
  await moreRes;
  await expect.poll(async () => grid.count()).toBeGreaterThan(before);
});

test("B2 buy promo pay delivers key", async ({ page }) => {
  await buyCard(page, SKU);
  await expect(page.locator("#status")).toHaveText("забронирован");
  const beforeAmounts = await page.locator("#amounts").textContent();
  await page.locator("#promoInput").fill(PROMO_WELCOME10);
  await page.locator("#applyPromoBtn").click();
  await expect(page.locator("#amounts")).not.toHaveText(beforeAmounts ?? "");
  await page.locator("#paySuccess").click();
  await expect(page.locator("#status")).toHaveText("доставлен");
  await expect(page.locator("#deliveryCode")).not.toHaveText("");
});

test("B3 pay fail", async ({ page }) => {
  await buyCard(page, SKU);
  await page.locator("#payFail").click();
  await expect(page.locator("#status")).toHaveText("оплата не прошла");
});

test("B4 admin form patch then delivered filter", async ({ page, request }) => {
  const offers = await fetchOffers(request);
  const nextPrice = uniquePatchPrice(offers);

  await page.goto("/admin.html");
  await page.locator("#tokenInput").fill(ADMIN_TOKEN);
  await page.locator("#saveToken").click();
  await page.locator("#offerIdInput").fill(OFFER_ID);
  await page.locator("#offerPriceInput").fill(String(nextPrice));
  await page.locator("#saveOfferBtn").click();
  await expect(page.locator("#offerStatus")).toHaveText(/^Сохранено /);

  await buyCard(page, SKU);
  const orderId = new URL(page.url()).searchParams.get("id");
  expect(orderId).toBeTruthy();
  await page.locator("#paySuccess").click();
  await expect(page.locator("#status")).toHaveText("доставлен");

  await page.goto("/admin.html");
  await page.locator('#orderFilters [data-status="delivered"]').click();
  await expect(page.locator("#ordersBody")).toContainText(orderId);
});

test("B5 admin unfulfilled shows out_of_stock with retry", async ({
  page,
  request,
}) => {
  const drain = await request.post("/api/test/drain-keys");
  expect(drain.ok()).toBeTruthy();

  await buyCard(page, SKU);
  const orderId = new URL(page.url()).searchParams.get("id");
  expect(orderId).toBeTruthy();
  await page.locator("#paySuccess").click();
  await expect(page.locator("#status")).toHaveText("нет в наличии");

  await page.goto("/admin.html");
  await page.locator('#orderFilters [data-status="unfulfilled"]').click();
  const row = page.locator("#ordersBody tr").filter({ hasText: orderId });
  await expect(row).toBeVisible();
  await expect(row.locator(".btn-retry")).toBeVisible();
});
