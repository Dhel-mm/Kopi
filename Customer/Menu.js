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


renderMenu();
bindEvents();
openEditorFromUrl();

function bindEvents() {
  tabs.addEventListener("click", selectCategory);
  search.addEventListener("input", () => filterMenu(search.value.trim().toLowerCase()));
  sections.addEventListener("click", handleMenuClick);
  customForm.addEventListener("submit", event => { event.preventDefault(); saveOrder(false); });
  document.getElementById("buyNowBtn").addEventListener("click", () => saveOrder(true));
  document.querySelector("[data-close-customizer]").addEventListener("click", closeCustomizer);
  document.querySelectorAll("[data-qty]").forEach(button => {
    button.addEventListener("click", () => {
      state.quantity = Math.max(1, state.quantity + (button.dataset.qty === "plus" ? 1 : -1));
      updatePrice();
    });
  });
}

function renderMenu() {
  tabs.innerHTML = KopiStore.products.map((category, index) => `
    <button class="tab-btn${index === 0 ? " active" : ""}" type="button" data-target="${category.id}">${category.label}</button>
  `).join("");

  sections.innerHTML = KopiStore.products.map((category, index) => `
    <section class="menu-category" id="${category.id}">
      <h2>${category.name}</h2>
      <div class="product-slider">
        <div class="product-row" id="product-row-${index + 1}">${category.products.map(productCard).join("")}</div>
        ${category.id === "kopi" ? `
          <div class="slider-buttons">
            <button class="slider-button" type="button" data-slide="previous" aria-label="Previous ${category.name} items">&#10094;</button>
            <button class="slider-button" type="button" data-slide="next" aria-label="Next ${category.name} items">&#10095;</button>
          </div>
        ` : ""}
      </div>
    </section>
  `).join("");
}

function productCard(product) {
  const sizes = sizeChoices(product);
  // Items with one price (rice meals, snacks) get the same white price chip.
  const priceInfo = sizes.length
    ? `<span class="size-chips" aria-label="Available sizes">${sizes.map(sizeChip).join("")}</span>`
    : `<span class="size-chips" aria-label="Price"><span class="size-chip price-only"><strong>₱${basePrice(product)}</strong></span></span>`;
  return `<button class="product-card" type="button" data-product-id="${product.id}">
    <img src="${product.image}" alt="${product.name}"><h3>${product.name}</h3>${priceInfo}
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

function sizeChip(choice) {
  const icon = choice.temperature === "HOT" ? "bi-cup-hot-fill" : choice.temperature === "ICED" ? "bi-snow" : "";
  const tone = choice.temperature ? ` ${choice.temperature.toLowerCase()}` : "";
  return `<span class="size-chip${tone}" data-size="${choice.value}" title="Choose ${choice.label}">
    ${icon ? `<i class="bi ${icon}" aria-hidden="true"></i>` : ""}<span>${choice.label}</span><strong>₱${choice.price}</strong>
  </span>`;
}

function priceLabel(product) {
  const prices = Object.values(prepareProduct(product).prices);
  const lowest = Math.min(...prices);
  const highest = Math.max(...prices);
  return lowest === highest ? `PHP ${lowest}` : `PHP ${lowest} - PHP ${highest}`;
}

function selectCategory(event) {
  const button = event.target.closest(".tab-btn");
  if (!button) return;
  tabs.querySelectorAll(".tab-btn").forEach(tab => tab.classList.remove("active"));
  button.classList.add("active");
  document.getElementById(button.dataset.target).scrollIntoView({ behavior: "smooth", block: "start" });
}

function handleMenuClick(event) {
  const card = event.target.closest(".product-card");
  if (card) {
    const product = KopiStore.findProduct(card.dataset.productId);
    if (!product) return;
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
    category.querySelectorAll(".product-card").forEach(card => {
      const matches = !query || card.textContent.toLowerCase().includes(query) || categoryName.includes(query);
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
  customImage.src = product.image;
  customImage.alt = product.name;
  customTitle.textContent = product.name;
  customDescription.textContent = product.description;
  renderOptions();
  updatePrice();
  customizer.classList.add("open");
  customizer.setAttribute("aria-hidden", "false");
}

function renderOptions() {
  customOptions.innerHTML = state.product.options.map(option => `
    <fieldset><legend>${option.label}:</legend><div class="pill-row">
      ${option.values.map(value => `<button class="pill${state.choices[option.key] === value ? " active" : ""}" type="button" data-key="${option.key}" data-value="${value}" aria-pressed="${state.choices[option.key] === value}">${value}${option.priceKey && state.product.prices[value] != null ? ` · ₱${state.product.prices[value]}` : ""}</button>`).join("")}
    </div></fieldset>
  `).join("");
  customOptions.querySelectorAll(".pill").forEach(pill => pill.addEventListener("click", () => {
    const { key, value } = pill.dataset;
    state.choices[key] = key === "addons" && state.choices[key] === value ? null : value;
    renderOptions();
    updatePrice();
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
  quantityValue.textContent = state.quantity;
  customPrice.textContent = `₱ ${unitPrice() * state.quantity}`;
}

function currentOrder() {
  const options = {};
  state.product.options.forEach(option => { if (state.choices[option.key] != null) options[option.label] = state.choices[option.key]; });
  return { productId: state.product.id, name: state.product.name, image: state.product.image, options, price: unitPrice(), quantity: state.quantity };
}

function saveOrder(goToCheckout) {
  const missing = state.product.options.find(option => option.priceKey && !state.choices[option.key]);
  if (missing) { KopiNotice.toast(`Please select ${missing.label.toLowerCase()} first.`); return; }
  const order = currentOrder();
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
