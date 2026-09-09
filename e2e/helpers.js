import { formatPrice } from "../public/js/catalog-buy.js";

export { formatPrice };

export const SKU = "KEY-CS2-PRIME";
export const OFFER_ID = "off_race_last";
export const ADMIN_TOKEN = "dev-admin-token";
export const PROMO_WELCOME10 = "WELCOME10";

export function uniquePatchPrice(offers) {
  const prices = offers.map((o) => o.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min > 0 ? min - 1 : max + 100;
}

export function cardPriceLabel(minPrice) {
  return formatPrice(minPrice);
}

export async function resetDb(request) {
  const res = await request.post("/api/test/reset-db");
  if (!res.ok()) {
    throw new Error(`reset-db ${res.status()}`);
  }
}

export async function fetchOffers(request, sku = SKU) {
  const res = await request.get(
    `/api/catalog/offers?sku=${encodeURIComponent(sku)}`,
  );
  if (!res.ok()) {
    throw new Error(`offers ${res.status()}`);
  }
  const body = await res.json();
  return body.offers;
}

export async function adminPatch(request, offerId, body) {
  const res = await request.patch(`/api/admin/offers/${offerId}`, {
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": ADMIN_TOKEN,
    },
    data: body,
  });
  if (!res.ok()) {
    throw new Error(`adminPatch ${res.status()}`);
  }
  return res.json();
}

export async function waitForCard(page, sku) {
  await page
    .locator(`#productsGrid article.product-card[data-sku="${sku}"]`)
    .waitFor({ state: "visible" });
}

export async function searchSku(page, sku) {
  const itemsTab = page.locator('#categoryFilters [data-category="items"]');
  if ((await itemsTab.count()) > 0) {
    const catRes = page.waitForResponse(
      (r) => r.url().includes("/api/catalog?") && r.ok(),
    );
    await itemsTab.click();
    await catRes;
  }
  const qRes = page.waitForResponse((r) => {
    if (!r.ok() || !r.url().includes("/api/catalog?")) return false;
    return new URL(r.url()).searchParams.get("q") === sku;
  });
  await page.locator("#searchInput").fill(sku);
  await qRes;
  await waitForCard(page, sku);
}

export async function soldOutSku(request, sku = SKU) {
  const offers = await fetchOffers(request, sku);
  for (const o of offers) {
    await adminPatch(request, o.offerId, { stockAvailable: 0 });
  }
}

export async function buyCard(page, sku = SKU) {
  let path = "";
  try {
    path = new URL(page.url()).pathname;
  } catch {
    path = "";
  }
  if (path !== "/") {
    await page.goto("/");
  }
  const buy = page.locator(
    `#productsGrid article.product-card[data-sku="${sku}"] .product-card__buy`,
  );
  if ((await buy.count()) === 0) {
    await searchSku(page, sku);
  }
  await buy.click();
  await page.waitForURL(/order\.html\?id=/);
}

export function watchOrderPosts(page) {
  const posts = [];
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    if (new URL(req.url()).pathname === "/api/orders") posts.push(req.url());
  });
  return posts;
}
