let buyInFlight = false;

export function formatPrice(price) {
  return `${Number(price).toLocaleString("ru-RU")} ₽`;
}

export function offerBuyLabel(stockAvailable) {
  return stockAvailable === 0 ? "Нет в наличии" : "Купить";
}

export function hideSoldOutBanner() {
  const banner = document.getElementById("soldOutBanner");
  if (banner) banner.hidden = true;
}

function syncBuyButtons(offersById) {
  document.querySelectorAll(".product-card__buy").forEach((b) => {
    const item = offersById.get(b.dataset.offerId);
    const soldOut = !item || item.stockAvailable === 0;
    b.disabled = buyInFlight || soldOut;
    b.textContent = item ? offerBuyLabel(item.stockAvailable) : "Купить";
    b.classList.toggle("product-card__buy--sold-out", soldOut);
  });
}

export function showSoldOut({ message, alternatives = [] } = {}, onPickOffer) {
  let banner = document.getElementById("soldOutBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "soldOutBanner";
    banner.className = "sf-sold-out";
    banner.innerHTML = `
      <div class="sf-sold-out__inner">
        <p class="sf-sold-out__message"></p>
        <div class="sf-sold-out__alts"></div>
        <button type="button" class="sf-sold-out__close">Закрыть</button>
      </div>
    `;
    document.body.appendChild(banner);
    banner.querySelector(".sf-sold-out__close").addEventListener("click", hideSoldOutBanner);
  }

  banner.querySelector(".sf-sold-out__message").textContent =
    message || "Товар только что раскупили";
  const altsEl = banner.querySelector(".sf-sold-out__alts");
  altsEl.innerHTML = "";
  alternatives.forEach((alt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sf-sold-out__alt";
    btn.dataset.offerId = alt.offerId;
    btn.textContent = `${alt.sellerName} — ${formatPrice(alt.price)} (${alt.stockAvailable} шт.)`;
    btn.addEventListener("click", () => {
      hideSoldOutBanner();
      onPickOffer(alt.offerId, btn);
    });
    altsEl.appendChild(btn);
  });
  banner.hidden = false;
}

const RETRYABLE_ORDER = new Set(["hold_expired", "payment_failed"]);

export function shouldCreateNewOrder(status) {
  return RETRYABLE_ORDER.has(status);
}

function idemStorageKey(offerId) {
  return `idem:${offerId}`;
}

function orderStorageKey(offerId) {
  return `order:${offerId}`;
}

function clearOfferKeys(offerId) {
  sessionStorage.removeItem(idemStorageKey(offerId));
  sessionStorage.removeItem(orderStorageKey(offerId));
}

export async function buyOffer(offerId, btn, offersById) {
  if (buyInFlight) return;
  buyInFlight = true;
  if (btn) btn.disabled = true;
  syncBuyButtons(offersById);

  try {
    const existingId = sessionStorage.getItem(orderStorageKey(offerId));
    if (existingId) {
      const existingRes = await fetch(`/api/orders/${existingId}`);
      if (existingRes.status === 404) {
        clearOfferKeys(offerId);
      } else if (!existingRes.ok) {
        throw new Error("order lookup failed");
      } else {
        const existing = await existingRes.json();
        if (!shouldCreateNewOrder(existing.status)) {
          location.href = `/order.html?id=${existing.id}`;
          return;
        }
        clearOfferKeys(offerId);
      }
    }

    let idem = sessionStorage.getItem(idemStorageKey(offerId));
    if (!idem) {
      idem = crypto.randomUUID();
      sessionStorage.setItem(idemStorageKey(offerId), idem);
    }

    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offerId, idempotency_key: idem }),
    });

    if (res.status === 409) {
      const body = await res.json();
      buyInFlight = false;
      syncBuyButtons(offersById);
      showSoldOut(body, (id, altBtn) => {
        buyOffer(id, altBtn, offersById);
      });
      return;
    }
    if (!res.ok) throw new Error("order failed");

    const order = await res.json();
    sessionStorage.setItem(orderStorageKey(offerId), order.id);
    location.href = `/order.html?id=${order.id}`;
  } catch {
    buyInFlight = false;
    syncBuyButtons(offersById);
  }
}
