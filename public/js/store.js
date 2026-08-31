const BUY_SKU = "KEY-CS2-PRIME";
let buyInFlight = false;

const TYPE_TO_CATEGORY = {
  topup: "donate",
  subscription: "subscription",
  key: "items",
  giftcard: "accounts",
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

const FEATURED_STATIC = {
  title: "💥 DOOM 2016 💀 STEAM KEY 🔑\nРФ+СНГ",
  price: 990,
  oldPrice: 1990,
  cover: "/assets/product-cover.jpg",
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

const FILTER_FN = {
  donate: (p) => p.type === "topup",
  subscription: (p) => p.type === "subscription",
  items: (p) => p.type === "key",
  accounts: (p) => p.type === "giftcard",
  keys: (p) => p.type === "key",
  game_valut: (p) => p.type === "giftcard",
  other: (p) => !["topup", "subscription", "key", "giftcard"].includes(p.type),
};

function buyIdempotencyKey(sku) {
  const storageKey = `buy_idempotency_${sku}`;
  let key = sessionStorage.getItem(storageKey);
  if (!key) {
    key = `buy_${sku}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(storageKey, key);
  }
  return key;
}

function enrichProduct(p) {
  const meta = PRODUCT_META[p.sku] || {};
  const category = TYPE_TO_CATEGORY[p.type] || "items";
  const isIcon = p.image && p.image.endsWith(".svg");
  const cover =
    meta.cover ||
    (isIcon ? "/assets/product-cover.jpg" : p.image) ||
    "/assets/product-cover.jpg";
  const displayTitle = meta.displayTitle || p.name;
  const oldPrice = meta.oldPrice;
  return { ...p, category, cover, displayTitle, oldPrice };
}

function formatTitleHtml(title) {
  return title
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("<br>");
}

function createProductCard(p) {
  const card = document.createElement("article");
  card.className = "product-card";
  card.dataset.category = p.category;
  card.dataset.sku = p.sku;

  const oldPriceHtml = p.oldPrice
    ? `<span class="product-card__price-old">${p.oldPrice.toLocaleString("ru-RU")} ₽</span>`
    : "";

  card.innerHTML = `
    <div class="product-card__media">
      <img src="${p.cover}" alt="" loading="lazy">
    </div>
    <div class="product-card__body">
      <div class="product-card__title">${formatTitleHtml(p.displayTitle)}</div>
      <div class="product-card__prices">
        <span class="product-card__price">${p.price.toLocaleString("ru-RU")} ₽</span>
        ${oldPriceHtml}
      </div>
      <button type="button" class="product-card__buy" data-sku="${p.sku}">Купить</button>
    </div>
  `;
  return card;
}

function createFeaturedCard() {
  return createProductCard({
    sku: BUY_SKU,
    category: "items",
    cover: FEATURED_STATIC.cover,
    displayTitle: FEATURED_STATIC.title,
    price: FEATURED_STATIC.price,
    oldPrice: FEATURED_STATIC.oldPrice,
  });
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

function initFilters(products) {
  const filters = document.getElementById("categoryFilters");
  const grid = document.getElementById("productsGrid");
  const empty = document.getElementById("productsEmpty");
  let active = "donate";

  function render(category) {
    active = category;
    grid.innerHTML = "";
    const filterFn = FILTER_FN[category] || FILTER_FN.donate;
    const filtered = products.filter(filterFn);
    filtered.forEach((p) => grid.appendChild(createProductCard(p)));
    empty.hidden = filtered.length > 0;
    filters.querySelectorAll(".sf-filter").forEach((btn) => {
      btn.classList.toggle(
        "sf-filter--active",
        btn.dataset.category === category,
      );
    });
  }

  filters.addEventListener("click", (e) => {
    const btn = e.target.closest(".sf-filter");
    if (!btn) return;
    render(btn.dataset.category);
  });

  render(active);
}

async function loadProducts() {
  const res = await fetch("/api/products");
  const { products: raw } = await res.json();
  const products = raw.map(enrichProduct);

  const featuredRow = document.getElementById("featuredRow");
  for (let i = 0; i < 5; i += 1) {
    featuredRow.appendChild(createFeaturedCard());
  }

  const otherRow = document.getElementById("otherRow");
  const cs2 = products.find((p) => p.sku === BUY_SKU);
  const otherProducts = cs2
    ? [cs2, ...products.filter((p) => p.sku !== BUY_SKU)]
    : products;
  otherProducts
    .slice(0, 5)
    .forEach((p) => otherRow.appendChild(createProductCard(p)));

  initFilters(products);

  document.querySelector(".sf-main").addEventListener("click", onBuyClick);
}

async function onBuyClick(e) {
  const btn = e.target.closest(".product-card__buy");
  if (!btn || buyInFlight) return;
  const { sku } = btn.dataset;
  if (!sku) return;

  buyInFlight = true;
  btn.disabled = true;
  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku, idempotency_key: buyIdempotencyKey(sku) }),
    });
    if (!res.ok) throw new Error("order failed");
    const order = await res.json();
    sessionStorage.removeItem(`buy_idempotency_${sku}`);
    location.href = `/order.html?id=${order.id}`;
  } catch {
    buyInFlight = false;
    btn.disabled = false;
  }
}

initCarousel();
initCatalog();
initTopup();
initServices();
loadProducts();
