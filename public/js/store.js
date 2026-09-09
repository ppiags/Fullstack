import { buyOffer, formatPrice, offerBuyLabel } from "./catalog-buy.js";

const PAGE_SIZE = 20;
/** @type {Map<string, object>} */
const popularBySku = new Map();
/** @type {Map<string, { stockAvailable: number, price: number, sellerName: string }>} */
const offersById = new Map();
let popularOffset = 0;
let popularTotal = 0;
let popularLoading = false;
let filterGeneration = 0;
let activeCategory = "donate";
let activeFilters = { q: "", type: "", other: "", min: "", max: "" };
let filterDebounceTimer = null;
let ws = null;
let wsReconnectDelay = 1000;
let wsReconnectTimer = null;

const CATEGORY_TO_TYPE = {
  donate: "topup",
  subscription: "subscription",
  items: "key",
  keys: "key",
  accounts: "giftcard",
  game_valut: "giftcard",
};

const PRODUCT_META = {
  "STEAM-TOPUP-500": { oldPrice: 600, displayTitle: "Пополнение Steam 500 ₽" },
  "STEAM-TOPUP-1000": {
    oldPrice: 1200,
    displayTitle: "Пополнение Steam 1000 ₽",
  },
  "STEAM-TOPUP-2500": {
    oldPrice: 2800,
    displayTitle: "Пополнение Steam 2500 ₽",
  },
  "KEY-CS2-PRIME": {
    oldPrice: 1990,
    displayTitle: "💥 CS2 Prime 💀 STEAM KEY 🔑\nРФ+СНГ",
    cover: "/assets/product-cover.jpg",
  },
  "KEY-GTA5": {
    oldPrice: 2490,
    displayTitle: "GTA V ключ активации\nРФ+СНГ",
    cover: "/assets/product-cover.jpg",
  },
  "KEY-EFT": {
    oldPrice: 4490,
    displayTitle: "Escape from Tarkov ключ\nРФ+СНГ",
    cover: "/assets/product-cover.jpg",
  },
  "SUB-DISCORD-1M": { oldPrice: 499, displayTitle: "Discord Nitro 1 месяц" },
  "SUB-YT-3M": { oldPrice: 1990, displayTitle: "YouTube Premium 3 месяца" },
  "SUB-SPOTIFY-1M": { oldPrice: 399, displayTitle: "Spotify Premium 1 месяц" },
  "GIFT-PSN-1000": { oldPrice: 1100, displayTitle: "PlayStation Store 1000 ₽" },
  "GIFT-XBOX-1500": { oldPrice: 1700, displayTitle: "Xbox Gift Card 1500 ₽" },
  "GIFT-ROBLOX-800": { oldPrice: 990, displayTitle: "Roblox 800 Robux" },
};

const TOPUP_SERVICES = [
  {
    id: "steam",
    name: "Steam",
    icon: "/assets/figma/steam.png",
    fieldLabel: "Логин Steam",
  },
  {
    id: "telegram",
    name: "Telegram",
    icon: "/assets/figma/telegram.png",
    fieldLabel: "Username",
  },
  {
    id: "roblox",
    name: "Roblox",
    icon: "/assets/figma/roblox.png",
    fieldLabel: "Логин Roblox",
  },
  {
    id: "brawl",
    name: "Brawl Stars",
    icon: "/assets/figma/brawl.png",
    fieldLabel: "Player ID",
  },
  {
    id: "pubg",
    name: "PUBG Mob...",
    icon: "/assets/figma/pubg.png",
    fieldLabel: "ID игрока",
    titleName: "PUBG Mobile",
  },
  {
    id: "appstore",
    name: "App Store",
    icon: "/assets/figma/appstore.png",
    fieldLabel: "Apple ID",
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    icon: "/assets/figma/chatgpt.png",
    fieldLabel: "Email",
  },
  {
    id: "psn",
    name: "PlayStation",
    icon: "/assets/figma/psn.png",
    fieldLabel: "PSN ID",
  },
  {
    id: "tiktok",
    name: "TikTok",
    icon: "/assets/figma/tiktok.png",
    fieldLabel: "Username",
  },
  {
    id: "mobile-leg",
    name: "Mobile Leg..",
    icon: "/assets/figma/mobile-leg.png",
    fieldLabel: "ID игрока",
    titleName: "Mobile Legends",
  },
  {
    id: "more",
    name: "еще 841",
    icon: "/assets/figma/more-grid.svg",
    isMore: true,
  },
];

function readUrl() {
  const params = new URLSearchParams(location.search);
  return {
    q: params.get("q") || "",
    type: params.get("type") || "",
    other: params.get("other") || "",
    min: params.get("min") || "",
    max: params.get("max") || "",
  };
}

function syncUrl() {
  const params = new URLSearchParams();
  if (activeFilters.q) params.set("q", activeFilters.q);
  if (activeFilters.other === "1") params.set("other", "1");
  else if (activeFilters.type) params.set("type", activeFilters.type);
  if (activeFilters.min) params.set("min", activeFilters.min);
  if (activeFilters.max) params.set("max", activeFilters.max);
  const qs = params.toString();
  const next = qs ? `${location.pathname}?${qs}` : location.pathname;
  history.replaceState(null, "", next);
}

function formatTitleHtml(title) {
  return title
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("<br>");
}

function rememberBuyOffer(product) {
  if (!product.buyOfferId) return;
  offersById.set(product.buyOfferId, {
    stockAvailable: product.buyStockAvailable,
    price: product.minPrice,
    sellerName: "",
  });
}

function createProductCard(product) {
  const meta = PRODUCT_META[product.sku] || {};
  const cover = meta.cover || "/assets/product-cover.jpg";
  const displayTitle = meta.displayTitle || product.name;
  const oldPriceHtml = meta.oldPrice
    ? `<span class="product-card__price-old">${meta.oldPrice.toLocaleString("ru-RU")} ₽</span>`
    : "";
  const soldOut = product.buyStockAvailable === 0;
  rememberBuyOffer(product);

  const card = document.createElement("article");
  card.className = "product-card";
  card.dataset.sku = product.sku;
  card.dataset.offerId = product.buyOfferId;
  card.innerHTML = `
    <div class="product-card__media">
      <img src="${cover}" alt="" loading="lazy">
    </div>
    <div class="product-card__body">
      <div class="product-card__title">${formatTitleHtml(displayTitle)}</div>
      <div class="product-card__prices">
        <span class="product-card__price">${formatPrice(product.minPrice)}</span>
        ${oldPriceHtml}
      </div>
      <button type="button" class="product-card__buy${soldOut ? " product-card__buy--sold-out" : ""}" data-offer-id="${product.buyOfferId}"${soldOut ? " disabled" : ""}>${offerBuyLabel(product.buyStockAvailable)}</button>
    </div>
  `;
  return card;
}

function applyProductAgg(sku, { minPrice, offerCount, buyOfferId, buyStockAvailable }) {
  const cached = popularBySku.get(sku);
  if (cached) {
    cached.minPrice = minPrice;
    cached.offerCount = offerCount;
    cached.buyOfferId = buyOfferId;
    cached.buyStockAvailable = buyStockAvailable;
  }
  rememberBuyOffer({ buyOfferId, buyStockAvailable, minPrice });
  document.querySelectorAll(`article.product-card[data-sku="${CSS.escape(sku)}"]`).forEach((card) => {
    const priceEl = card.querySelector(".product-card__price");
    const buy = card.querySelector(".product-card__buy");
    if (priceEl) priceEl.textContent = formatPrice(minPrice);
    if (buyOfferId) card.dataset.offerId = buyOfferId;
    if (buy && buyOfferId != null && buyStockAvailable != null) {
      buy.dataset.offerId = buyOfferId;
      const soldOut = buyStockAvailable === 0;
      buy.disabled = soldOut;
      buy.textContent = offerBuyLabel(buyStockAvailable);
      buy.classList.toggle("product-card__buy--sold-out", soldOut);
    }
  });
}

function collectFilters() {
  const searchInput = document.getElementById("searchInput");
  const minInput = document.getElementById("priceMin");
  const maxInput = document.getElementById("priceMax");
  const other = activeCategory === "other" ? "1" : "";
  const typeFromCategory = other ? "" : CATEGORY_TO_TYPE[activeCategory] || "";
  return {
    q: searchInput?.value ?? activeFilters.q,
    type: other ? "" : typeFromCategory,
    other,
    min: minInput?.value ?? activeFilters.min,
    max: maxInput?.value ?? activeFilters.max,
  };
}

function categoryFromUrl({ type, other, q }) {
  if (other === "1") return "other";
  if (!type) return q ? "" : "donate";
  const entry = Object.entries(CATEGORY_TO_TYPE).find(([, t]) => t === type);
  return entry?.[0] || "donate";
}

function catalogQuery(filters, { limit, offset }) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  if (filters.q) params.set("q", filters.q);
  if (filters.other === "1") params.set("other", "1");
  else if (filters.type) params.set("type", filters.type);
  if (filters.min) params.set("min", filters.min);
  if (filters.max) params.set("max", filters.max);
  return params;
}

function setCatalogError(text) {
  const el = document.getElementById("catalogError");
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = text;
}

function updateLoadMoreBtn() {
  const btn = document.getElementById("loadMoreBtn");
  if (!btn) return;
  const loaded = document.getElementById("productsGrid")?.children.length ?? 0;
  btn.hidden = loaded >= popularTotal;
}

async function fetchCatalog(filters, paging) {
  const res = await fetch(`/api/catalog?${catalogQuery(filters, paging)}`);
  if (!res.ok) throw new Error("catalog failed");
  return res.json();
}

async function loadPopular({ append }) {
  if (popularLoading && append) return;
  popularLoading = true;
  const gen = filterGeneration;
  const btn = document.getElementById("loadMoreBtn");
  if (btn && append) btn.disabled = true;
  const offset = append ? popularOffset : 0;
  try {
    const data = await fetchCatalog(activeFilters, { limit: PAGE_SIZE, offset });
    if (gen !== filterGeneration) return;
    const grid = document.getElementById("productsGrid");
    const empty = document.getElementById("productsEmpty");
    if (!grid) return;
    if (!append) {
      grid.innerHTML = "";
      popularBySku.clear();
    }
    data.products.forEach((p) => {
      popularBySku.set(p.sku, p);
      grid.appendChild(createProductCard(p));
    });
    popularTotal = data.total;
    popularOffset = offset + data.products.length;
    if (empty) empty.hidden = grid.children.length > 0;
    setCatalogError("");
    updateLoadMoreBtn();
  } catch {
    if (gen !== filterGeneration) return;
    setCatalogError("Не удалось загрузить каталог");
  } finally {
    popularLoading = false;
    if (btn) btn.disabled = false;
  }
}

function scheduleFilterApply() {
  filterGeneration += 1;
  clearTimeout(filterDebounceTimer);
  filterDebounceTimer = setTimeout(() => {
    activeFilters = collectFilters();
    syncUrl();
    popularOffset = 0;
    loadPopular({ append: false });
  }, 80);
}

function initSearchAndPriceFilters() {
  const searchInput = document.getElementById("searchInput");
  const minInput = document.getElementById("priceMin");
  const maxInput = document.getElementById("priceMax");
  const fromUrl = readUrl();
  activeFilters = { ...fromUrl };
  activeCategory = categoryFromUrl(fromUrl);
  if (searchInput && fromUrl.q) searchInput.value = fromUrl.q;
  if (minInput && fromUrl.min) minInput.value = fromUrl.min;
  if (maxInput && fromUrl.max) maxInput.value = fromUrl.max;
  searchInput?.addEventListener("input", scheduleFilterApply);
  minInput?.addEventListener("input", scheduleFilterApply);
  maxInput?.addEventListener("input", scheduleFilterApply);
  window.addEventListener("popstate", () => {
    const urlState = readUrl();
    activeFilters = { ...urlState };
    activeCategory = categoryFromUrl(urlState);
    if (searchInput) searchInput.value = urlState.q;
    if (minInput) minInput.value = urlState.min;
    if (maxInput) maxInput.value = urlState.max;
    document.querySelectorAll("#categoryFilters .sf-filter").forEach((btn) => {
      btn.classList.toggle("sf-filter--active", btn.dataset.category === activeCategory);
    });
    popularOffset = 0;
    loadPopular({ append: false });
  });
}

function initCategoryFilters() {
  const filters = document.getElementById("categoryFilters");
  if (!filters) return;
  filters.querySelectorAll(".sf-filter").forEach((btn) => {
    btn.classList.toggle("sf-filter--active", btn.dataset.category === activeCategory);
  });
  filters.addEventListener("click", (e) => {
    const btn = e.target.closest(".sf-filter");
    if (!btn) return;
    activeCategory = btn.dataset.category;
    filters.querySelectorAll(".sf-filter").forEach((b) => {
      b.classList.toggle("sf-filter--active", b.dataset.category === activeCategory);
    });
    scheduleFilterApply();
  });
}

async function renderFeaturedRows() {
  const featuredRow = document.getElementById("featuredRow");
  const otherRow = document.getElementById("otherRow");
  if (!featuredRow || !otherRow) return;
  const empty = { q: "", type: "", other: "", min: "", max: "" };
  try {
    const [feat, other] = await Promise.all([
      fetchCatalog(empty, { limit: 5, offset: 0 }),
      fetchCatalog(empty, { limit: 5, offset: 5 }),
    ]);
    featuredRow.innerHTML = "";
    otherRow.innerHTML = "";
    feat.products.forEach((p) => featuredRow.appendChild(createProductCard(p)));
    other.products.forEach((p) => otherRow.appendChild(createProductCard(p)));
  } catch {
    // keep previous side-row content or leave empty; do not block init/WS
  }
}

function handleWsMessage(event) {
  let msg;
  try {
    msg = JSON.parse(event.data);
  } catch {
    return;
  }
  if (msg.type !== "offer.updated") return;
  if (!msg.sku) return;
  if (msg.minPrice == null || msg.offerCount == null) return;
  if (msg.buyOfferId == null || msg.buyStockAvailable == null) return;
  applyProductAgg(msg.sku, {
    minPrice: msg.minPrice,
    offerCount: msg.offerCount,
    buyOfferId: msg.buyOfferId,
    buyStockAvailable: msg.buyStockAvailable,
  });
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

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.onmessage = handleWsMessage;
  ws.onclose = () => {
    wsReconnectTimer = setTimeout(async () => {
      try {
        await Promise.all([
          loadPopular({ append: false }),
          renderFeaturedRows(),
        ]);
      } catch {
        // reconnect even if refresh failed
      }
      connectWs();
      wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
    }, wsReconnectDelay);
  };
  ws.onopen = () => {
    wsReconnectDelay = 1000;
  };
}

function initCarousel() {
  const slides = [...document.querySelectorAll(".sf-carousel__slide")];
  const dotsContainer = document.getElementById("carouselDots");
  let current = 0;
  let timer;

  slides.forEach((_, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = `sf-carousel__dot${i === 0 ? " sf-carousel__dot--active" : ""}`;
    dot.addEventListener("click", () => goTo(i));
    dotsContainer.appendChild(dot);
  });

  const dots = [...dotsContainer.querySelectorAll(".sf-carousel__dot")];

  function goTo(index) {
    slides[current].classList.remove("sf-carousel__slide--active");
    dots[current].classList.remove("sf-carousel__dot--active");
    current = (index + slides.length) % slides.length;
    slides[current].classList.add("sf-carousel__slide--active");
    dots[current].classList.add("sf-carousel__dot--active");
  }

  function next() {
    goTo(current + 1);
  }
  function prev() {
    goTo(current - 1);
  }

  document.getElementById("carouselNext").addEventListener("click", () => {
    next();
    resetTimer();
  });
  document.getElementById("carouselPrev").addEventListener("click", () => {
    prev();
    resetTimer();
  });

  function resetTimer() {
    clearInterval(timer);
    timer = setInterval(next, 5000);
  }

  resetTimer();
}

function initCatalog() {
  const btn = document.getElementById("catalogBtn");
  const panel = document.getElementById("catalogPanel");
  const backdrop = document.getElementById("catalogBackdrop");
  const cats = [...document.querySelectorAll(".sf-catalog-cat")];

  function closeCatalog() {
    panel.setAttribute("hidden", "");
    backdrop.setAttribute("hidden", "");
    btn.setAttribute("aria-expanded", "false");
    btn.classList.remove("sf-catalog-btn--open");
  }

  function openCatalog() {
    panel.removeAttribute("hidden");
    backdrop.removeAttribute("hidden");
    btn.setAttribute("aria-expanded", "true");
    btn.classList.add("sf-catalog-btn--open");
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (panel.hasAttribute("hidden")) openCatalog();
    else closeCatalog();
  });

  backdrop.addEventListener("click", closeCatalog);

  cats.forEach((cat) => {
    cat.addEventListener("click", () => {
      cats.forEach((c) => c.classList.remove("sf-catalog-cat--active"));
      cat.classList.add("sf-catalog-cat--active");
    });
  });

  document.addEventListener("click", (e) => {
    if (panel.hasAttribute("hidden")) return;
    if (!panel.contains(e.target) && !btn.contains(e.target)) closeCatalog();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCatalog();
  });
}

function initTopup() {
  const currencyBtns = [...document.querySelectorAll(".sf-currency-btn")];

  currencyBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      currencyBtns.forEach((b) =>
        b.classList.remove("sf-currency-btn--active"),
      );
      btn.classList.add("sf-currency-btn--active");
    });
  });
}

function initServices() {
  const row = document.getElementById("servicesRow");
  const nameEl = document.getElementById("topupServiceName");
  const iconEl = document.getElementById("topupIcon");
  const labelEl = document.getElementById("topupFieldLabel");
  const buttons = [];

  TOPUP_SERVICES.forEach((service, i) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = `sf-service-tile${service.isMore ? " sf-service-tile--more" : ""}${i === 0 ? " sf-service-tile--active" : ""}`;
    tile.dataset.serviceId = service.id;

    if (service.isMore) {
      tile.innerHTML = `
        <span class="sf-service-tile__icon sf-service-tile__icon--more"><img src="${service.icon}" alt=""></span>
        <span class="sf-service-tile__label">${service.name}</span>
      `;
    } else {
      tile.innerHTML = `
        <span class="sf-service-tile__icon"><img src="${service.icon}" alt=""></span>
        <span class="sf-service-tile__label">${service.name}</span>
      `;
      tile.addEventListener("click", () => selectService(service.id));
      buttons.push(tile);
    }

    row.appendChild(tile);
  });

  function selectService(id) {
    const service = TOPUP_SERVICES.find((s) => s.id === id);
    if (!service || service.isMore) return;
    buttons.forEach((b) => {
      b.classList.toggle("sf-service-tile--active", b.dataset.serviceId === id);
    });
    const displayName = service.titleName || service.name.replace("...", "");
    nameEl.textContent = displayName;
    iconEl.src = service.icon;
    labelEl.textContent = service.fieldLabel;
  }
}

async function initStore() {
  initSearchAndPriceFilters();
  initCategoryFilters();
  document.getElementById("loadMoreBtn")?.addEventListener("click", () => {
    loadPopular({ append: true });
  });
  activeFilters = collectFilters();
  await Promise.all([loadPopular({ append: false }), renderFeaturedRows()]);
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".product-card__buy");
    if (!btn || btn.disabled) return;
    const offerId = btn.dataset.offerId;
    if (!offerId) return;
    buyOffer(offerId, btn, offersById);
  });
  connectWs();
}

initCarousel();
initCatalog();
initTopup();
initServices();
initStore();
