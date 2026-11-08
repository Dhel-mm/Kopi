const state = { product: null, editCartId: null, quantity: 1, choices: {} };

const tabs = document.getElementById("menuTabs");
const sections = document.getElementById("menuSections");
const search = document.getElementById("menuSearch");
const customizer = document.getElementById("customizer");
const customForm = document.getElementById("customForm");
const customImage = document.getElementById("customImage");
const customTitle = document.getElementById("customizerTitle");
const customDescription = document.getElementById("customDescription");
const customOptions = document.getElementById("customOptions");
const customPrice = document.getElementById("customPrice");
const quantityValue = document.getElementById("quantityValue");


// Items whose ingredients ran out (from inventory) show as unavailable until restocked.
const soldOut = new Set();
// Sizes, choices and add-ons that cannot be made right now, by product.
const soldChoices = new Map();
let lastAvailability = "";
const isSoldOut = (product, label, value) => (soldChoices.get(product.id)?.[label] || []).includes(value);
// The selected category tab ("all" shows every category), like Menu Management.
let activeCategory = "all";
renderMenu();
bindEvents();
openEditorFromUrl();
// Api.js loads after this script, so the first check waits for the page to finish loading.
document.addEventListener("DOMContentLoaded", refreshStockAvailability);
document.addEventListener("DOMContentLoaded", requireLogin);

// Visitors who are not logged in see a notice in the middle of the screen before the menu.
function requireLogin() {
  if (KopiApi.getSession()) return;
  const notice = document.createElement("dialog");
  notice.className = "login-notice";
  notice.setAttribute("aria-labelledby", "loginNoticeTitle");
  notice.innerHTML = `
    <div class="login-notice-card">
      <img src="HomePic/Logo.png" alt="" class="login-notice-logo">
      <h2 id="loginNoticeTitle">Log in to see our menu</h2>
      <p>Please log in or create a free account first, so you can order and track your coffee.</p>
      <div class="login-notice-actions">
        <a class="login-notice-btn solid" href="../login.html">Log in</a>
        <a class="login-notice-btn outline" href="../signup.html">Sign up</a>
      </div>
      <a class="login-notice-home" href="Homepage.html">Back to Home</a>
    </div>`;
  // The menu stays hidden behind the notice; Esc does not close it.
  notice.addEventListener("cancel", event => event.preventDefault());
  document.body.classList.add("needs-login");
  document.body.append(notice);
  notice.showModal();
}
setInterval(refreshStockAvailability, 60000);
window.addEventListener("focus", refreshStockAvailability);

async function refreshStockAvailability() {
  try {
    const { products } = await KopiApi.request("/menu/availability");
    const next = new Set(products.filter(item => !item.available).map(item => item.productId));
    const choices = products.filter(item => Object.keys(item.unavailable || {}).length).map(item => [item.productId, item.unavailable]);
    const signature = JSON.stringify([[...next].sort(), choices]);
    if (signature === lastAvailability) return;
    lastAvailability = signature;
    soldOut.clear();
    next.forEach(id => soldOut.add(id));
    soldChoices.clear();
    choices.forEach(([id, unavailable]) => soldChoices.set(id, unavailable));
    sections.querySelectorAll(".product-card").forEach(card => {
      const product = KopiStore.findProduct(card.dataset.productId);
      if (product) card.outerHTML = productCard(product);
    });
    filterMenu(search.value.trim().toLowerCase());
    if (state.product && customizer.classList.contains("open")) renderOptions();
  } catch {}
}

function bindEvents() {
  tabs.addEventListener("click", selectCategory);
  search.addEventListener("input", () => filterMenu(search.value.trim().toLowerCase()));
  sections.addEventListener("click", handleMenuClick);
  customForm.addEventListener("submit", event => { event.preventDefault(); saveOrder(false); });
  document.getElementById("buyNowBtn").addEventListener("click", () => saveOrder(true));
  document.querySelector("[data-close-customizer]").addEventListener("click", closeCustomizer);
  document.querySelectorAll("[data-qty]").forEach(button => {
    button.addEventListener("click", () => {
      setQuantity(state.quantity + (button.dataset.qty === "plus" ? 1 : -1));
    });
  });
  // The quantity can also be typed. Only numbers are kept, and leaving the box
  // brings an empty or too-large number back to something that can be ordered.
  quantityValue.addEventListener("input", () => {
    const digits = quantityValue.value.replace(/\D/g, "");
    if (digits !== quantityValue.value) quantityValue.value = digits;
    if (digits && Number(digits) >= 1) setQuantity(Number(digits), true);
  });
  quantityValue.addEventListener("blur", () => setQuantity(Number(quantityValue.value) || 1));
  quantityValue.addEventListener("focus", () => quantityValue.select());
  quantityValue.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    quantityValue.blur();
  });
}

// Keeps the quantity between 1 and what the order limit and current ingredients allow.
function setQuantity(requested, typing = false) {
  const room = KopiStore.room(state.product.id, state.editCartId);
  const stockLimit = state.stockLimit ?? Infinity;
  const allowed = Math.max(1, Math.min(room.limit, stockLimit));
  if (requested > allowed) {
    if (stockLimit < room.limit) showStockLimit();
    else KopiNotice.toast(KopiStore.limitMessage(room.kind), "warning");
  }
  state.quantity = Math.max(1, Math.min(allowed, requested));
  if (typing && requested <= allowed) customPrice.textContent = `₱ ${unitPrice() * state.quantity}`;
  else updatePrice();
}

// How many of this exact choice the shop's ingredients can make right now. The
// server counts what is already in the cart, because lines can share ingredients.
let stockVersion = 0;
function otherCartLines() {
  return KopiStore.getCart().filter(item => item.cartId !== state.editCartId)
    .map(item => ({productId: item.productId, quantity: item.quantity, options: item.options || {}}));
}
async function askStock(quantity, others) {
  return KopiApi.request("/orders/stock-check", {method: "POST", body: JSON.stringify({
    item: {productId: state.product.id, quantity, options: currentOrder().options}, others})});
}
async function refreshStockLimit() {
  if (typeof KopiApi === "undefined" || !KopiApi.getSession() || !state.product) return;
  const version = ++stockVersion;
  // Nothing to check until a size is chosen; choosing one checks again.
  if (state.product.options.some(option => option.priceKey && !state.choices[option.key])) return;
  try {
    const result = await askStock(1, otherCartLines());
    if (version !== stockVersion) return;
    state.stockLimit = result.maxQuantity;
    state.stockMessage = `Not enough ingredients for ${state.product.name}. ${result.maxQuantity ? `You can only add up to ${result.maxQuantity}.` : "No more can be added right now."}`;
    if (state.quantity > Math.max(1, result.maxQuantity)) setQuantity(state.quantity);
    if (state.stockLimit < state.quantity || !state.stockLimit) showStockLimit();
    else hideStockLimit();
  } catch {
    // Offline or not a customer account: the server still checks at checkout.
  }
}
function showStockLimit() {
  const note = document.getElementById("stockLimitNote");
  note.textContent = state.stockMessage || "Not enough ingredients for this item.";
  note.hidden = false;
  KopiNotice.toast(note.textContent, "warning");
}
function hideStockLimit() {
  const note = document.getElementById("stockLimitNote");
  if (note) note.hidden = true;
}

// Menu text comes from Menu Management, so it is escaped before it goes into HTML.
function menuText(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"}[character]));
}

function renderMenu() {
  tabs.innerHTML = [["all", "All Items"], ...KopiStore.products.map(category => [category.id, category.label])].map(([id, label]) => `
    <button class="tab-btn${id === activeCategory ? " active" : ""}" type="button" data-target="${menuText(id)}" aria-pressed="${id === activeCategory}">${menuText(label)}</button>
  `).join("");

  sections.innerHTML = KopiStore.products.map((category, index) => `
    <section class="menu-category" id="${menuText(category.id)}">
      <h2>${menuText(category.name)}</h2>
      <div class="product-slider">
        <div class="product-row" id="product-row-${index + 1}">${category.products.map(productCard).join("")}</div>
        <div class="slider-buttons">
          <button class="slider-button" type="button" data-slide="previous" aria-label="Previous ${menuText(category.name)} items">&#10094;</button>
          <button class="slider-button" type="button" data-slide="next" aria-label="Next ${menuText(category.name)} items">&#10095;</button>
        </div>
      </div>
    </section>
  `).join("");
}

function productCard(product) {
  const sizes = sizeChoices(product);
  // Items with one price (rice meals, snacks) get the same white price chip.
  const priceInfo = sizes.length
    ? `<span class="size-chips" aria-label="Available sizes">${sizes.map(choice => sizeChip(choice, product)).join("")}</span>`
    : `<span class="size-chips" aria-label="Price"><span class="size-chip price-only"><strong>₱${basePrice(product)}</strong></span></span>`;
  // Items the shop marked unavailable stay visible but cannot be ordered.
  if (product.available === false || soldOut.has(product.id)) {
    return `<button class="product-card is-unavailable" type="button" data-product-id="${menuText(product.id)}" aria-disabled="true">
    <span class="product-unavailable">Unavailable</span>
    <img src="${menuText(product.image)}" alt="${menuText(product.name)}"><h3>${menuText(product.name)}</h3>${priceInfo}
  </button>`;
  }
  return `<button class="product-card" type="button" data-product-id="${menuText(product.id)}">
    <img src="${menuText(product.image)}" alt="${menuText(product.name)}"><h3>${menuText(product.name)}</h3>${priceInfo}
  </button>`;
}

// Every size a product is actually sold in, read from the shared menu prices.
// Drinks always show their sizes; food shows them only when there is a choice
// (for example 6pcs or 12pcs chicken wings).
function sizeChoices(product) {
  const option = product.options.find(entry => entry.priceKey);
  if (!option) return [];
  const values = option.values.filter(value => Object.hasOwn(product.prices, value));
  if (product.type !== "drink" && values.length < 2) return [];
  return values.map(value => ({ value, ...describeSize(value), price: product.prices[value] }));
}

function describeSize(value) {
  const [temperature, size] = value.includes(" - ") ? value.split(" - ").map(part => part.trim()) : [null, value.trim()];
  const label = temperature ? `${temperature.charAt(0)}${temperature.slice(1).toLowerCase()} ${size}` : size;
  return { temperature, size, label };
}

function sizeChip(choice, product) {
  const icon = choice.temperature === "HOT" ? "bi-cup-hot-fill" : choice.temperature === "ICED" ? "bi-snow" : "";
  const tone = choice.temperature ? ` ${choice.temperature.toLowerCase()}` : "";
  const sizeLabel = product?.options.find(option => option.priceKey)?.label;
  // A size whose ingredients ran out is crossed out on the card.
  if (product && sizeLabel && isSoldOut(product, sizeLabel, choice.value)) {
    return `<span class="size-chip${tone} sold-out" title="${menuText(choice.label)} is sold out right now">
    ${icon ? `<i class="bi ${icon}" aria-hidden="true"></i>` : ""}<span>${menuText(choice.label)}</span><strong>Sold out</strong>
  </span>`;
  }
  return `<span class="size-chip${tone}" data-size="${menuText(choice.value)}" title="Choose ${menuText(choice.label)}">
    ${icon ? `<i class="bi ${icon}" aria-hidden="true"></i>` : ""}<span>${menuText(choice.label)}</span><strong>₱${choice.price}</strong>
  </span>`;
}

function priceLabel(product) {
  const prices = Object.values(prepareProduct(product).prices);
  const lowest = Math.min(...prices);
  const highest = Math.max(...prices);
  return lowest === highest ? `PHP ${lowest}` : `PHP ${lowest} - PHP ${highest}`;
}

// Tabs show one category at a time (or all of them), and work together with search.
function selectCategory(event) {
  const button = event.target.closest(".tab-btn");
  if (!button) return;
  activeCategory = button.dataset.target;
  tabs.querySelectorAll(".tab-btn").forEach(tab => {
    tab.classList.toggle("active", tab === button);
    tab.setAttribute("aria-pressed", String(tab === button));
  });
  filterMenu(search.value.trim().toLowerCase());
  // Bring the tabs back into view just below the sticky header, only if the page was scrolled past them.
  const headerHeight = document.querySelector(".site-header")?.offsetHeight || 0;
  const top = tabs.getBoundingClientRect().top + window.scrollY - headerHeight - 8;
  if (window.scrollY > top) window.scrollTo({ top, behavior: "smooth" });
}

// Arrow buttons appear only when a row has more cards than fit (laptop widths; CSS hides them on tablets and phones).
function updateSliders() {
  sections.querySelectorAll(".product-slider").forEach(slider => {
    const row = slider.querySelector(".product-row");
    const overflow = row.scrollWidth - row.clientWidth > 4;
    slider.classList.toggle("can-scroll", overflow);
    const [previous, next] = slider.querySelectorAll("[data-slide]");
    if (previous) previous.disabled = row.scrollLeft <= 4;
    if (next) next.disabled = row.scrollLeft + row.clientWidth >= row.scrollWidth - 4;
  });
}
sections.addEventListener("scroll", event => { if (event.target.classList?.contains("product-row")) updateSliders(); }, true);
window.addEventListener("resize", updateSliders);
window.addEventListener("load", updateSliders);

function handleMenuClick(event) {
  const card = event.target.closest(".product-card");
  if (card) {
    const product = KopiStore.findProduct(card.dataset.productId);
    if (!product) return;
    if (product.available === false || soldOut.has(product.id)) {
      KopiNotice.toast(`${product.name} is not available right now.`, "warning");
      return;
    }
    if (product.customizable === false) addFixedProduct(product);
    else {
      // Tapping a size chip opens the customizer with that size already chosen.
      const chip = event.target.closest("[data-size]");
      openCustomizer(prepareProduct(product, card.closest(".menu-category").id), null, chip ? { size: chip.dataset.size } : {});
    }
    return;
  }

  const button = event.target.closest("[data-slide]");
  if (!button) return;
  const row = button.closest(".product-slider").querySelector(".product-row");
  row.scrollBy({ left: (button.dataset.slide === "next" ? 1 : -1) * Math.round(row.clientWidth * 0.85), behavior: "smooth" });
}

function filterMenu(query) {
  let hasResults = false;
  sections.querySelectorAll(".menu-category").forEach(category => {
    const categoryName = category.querySelector("h2").textContent.toLowerCase();
    let hasVisibleProduct = false;
    const inTab = activeCategory === "all" || category.id === activeCategory;
    category.querySelectorAll(".product-card").forEach(card => {
      const matches = inTab && (!query || card.textContent.toLowerCase().includes(query) || categoryName.includes(query));
      card.hidden = !matches;
      hasVisibleProduct ||= matches;
    });
    category.hidden = !hasVisibleProduct;
    hasResults ||= hasVisibleProduct;
  });
  document.querySelector(".empty-state")?.remove();
  if (!hasResults) {
    const message = document.createElement("p");
    message.className = "empty-state";
    message.textContent = "No menu item found.";
    sections.append(message);
  }
  updateSliders();
}

function prepareProduct(product) { return product; }

function addFixedProduct(product) {
  KopiStore.addToCart({ productId: product.id, name: product.name, image: product.image, options: {}, price: basePrice(product), quantity: 1 });
}

function openCustomizer(product, cartItem = null, preset = {}) {
  state.product = product;
  state.editCartId = cartItem?.cartId || null;
  state.quantity = cartItem?.quantity || 1;
  state.choices = {};
  product.options.forEach(option => {
    const savedChoice = cartItem?.options?.[option.label] ?? cartItem?.options?.[option.key];
    state.choices[option.key] = option.key === "addons"
      ? savedChoice ?? null
      : savedChoice ?? option.defaultValue ?? (option.values.length === 1 ? option.values[0] : null);
  });
  const sizeOption = product.options.find(option => option.priceKey);
  if (sizeOption && sizeOption.values.includes(preset.size)) state.choices[sizeOption.key] = preset.size;
  product.options.forEach(option => {
    if (state.choices[option.key] != null && isSoldOut(product, option.label, state.choices[option.key])) {
      state.choices[option.key] = option.addOnPrice ? null : option.values.find(value => !isSoldOut(product, option.label, value)) ?? null;
    }
  });
  customImage.src = product.image;
  customImage.alt = product.name;
  customTitle.textContent = product.name;
  customDescription.textContent = product.description;
  state.stockLimit = null;
  hideStockLimit();
  renderOptions();
  updatePrice();
  refreshStockLimit();
  customizer.classList.add("open");
  customizer.setAttribute("aria-hidden", "false");
}

function renderOptions() {
  customOptions.innerHTML = state.product.options.map(option => `
    <fieldset><legend>${option.label}:</legend><div class="pill-row">
      ${option.values.map(value => isSoldOut(state.product, option.label, value)
        ? `<button class="pill sold-out" type="button" disabled aria-disabled="true" title="Sold out right now">${menuText(value)} · Sold out</button>`
        : `<button class="pill${state.choices[option.key] === value ? " active" : ""}" type="button" data-key="${option.key}" data-value="${menuText(value)}" aria-pressed="${state.choices[option.key] === value}">${menuText(value)}${option.priceKey && state.product.prices[value] != null ? ` · ₱${state.product.prices[value]}` : ""}</button>`).join("")}
    </div></fieldset>
  `).join("");
  customOptions.querySelectorAll(".pill:not(.sold-out)").forEach(pill => pill.addEventListener("click", () => {
    const { key, value } = pill.dataset;
    state.choices[key] = key === "addons" && state.choices[key] === value ? null : value;
    renderOptions();
    updatePrice();
    refreshStockLimit();
  }));
}

function basePrice(product) { return Object.values(product.prices)[0]; }

function unitPrice() {
  const priceOption = state.product.options.find(option => option.priceKey);
  const price = priceOption ? state.product.prices[state.choices[priceOption.key]] : null;
  const addOnPrice = state.product.options.reduce((total, option) => total + (option.addOnPrice && state.choices[option.key] ? option.addOnPrice : 0), 0);
  return (price ?? basePrice(state.product)) + addOnPrice;
}

function updatePrice() {
  quantityValue.value = state.quantity;
  customPrice.textContent = `₱ ${unitPrice() * state.quantity}`;
}

function currentOrder() {
  const options = {};
  state.product.options.forEach(option => { if (state.choices[option.key] != null) options[option.label] = state.choices[option.key]; });
  return { productId: state.product.id, name: state.product.name, image: state.product.image, options, price: unitPrice(), quantity: state.quantity };
}

async function saveOrder(goToCheckout) {
  const missing = state.product.options.find(option => option.priceKey && !state.choices[option.key]);
  if (missing) { KopiNotice.toast(`Please select ${missing.label.toLowerCase()} first.`); return; }
  setQuantity(Number(quantityValue.value) || 1);
  const order = currentOrder();
  // Adding to the cart counts what is already there; Buy now is a separate order.
  const room = goToCheckout ? KopiStore.room(order.productId, null, []) : KopiStore.room(order.productId, state.editCartId);
  if (order.quantity > room.left) {
    KopiNotice.toast(room.left
      ? `${KopiStore.limitMessage(room.kind)} You already have ${room.used} in your cart, so you can add ${room.left} more.`
      : `${KopiStore.limitMessage(room.kind)} Your cart already has ${room.used}.`, "warning");
    return;
  }
  // Last check with the server: a short ingredient stops the item here, before checkout.
  if (typeof KopiApi !== "undefined" && KopiApi.getSession()) {
    try {
      const result = await askStock(order.quantity, goToCheckout ? [] : otherCartLines());
      if (!result.ok) {
        state.stockLimit = result.maxQuantity;
        state.stockMessage = result.message;
        showStockLimit();
        return;
      }
    } catch (error) {
      if (error.status === 409) { KopiNotice.toast(error.message, "warning"); return; }
      // Network trouble: the server checks the stock again at checkout.
    }
  }
  if (state.editCartId) KopiStore.updateCartItem(state.editCartId, order);
  else if (!goToCheckout) KopiStore.addToCart(order);
  if (goToCheckout) {
    KopiStore.setCheckout([{ ...order, cartId: state.editCartId || "buy-now" }]);
    window.location.href = "Cart.html?checkout=1";
  } else closeCustomizer();
}

function closeCustomizer() {
  customizer.classList.remove("open");
  customizer.setAttribute("aria-hidden", "true");
  history.replaceState(null, "", "Menu.html");
}

function openEditorFromUrl() {
  const editId = new URLSearchParams(window.location.search).get("edit");
  const cartItem = editId && KopiStore.getCart().find(item => item.cartId === editId);
  const product = cartItem && KopiStore.findProduct(cartItem.productId);
  if (!product?.customizable) return;
  const category = KopiStore.products.find(group => group.products.some(item => item.id === product.id));
  openCustomizer(prepareProduct(product, category?.id), cartItem);
}
