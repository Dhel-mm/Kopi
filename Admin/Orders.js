/**
 * Orders.js
 * ---------
 * Drives the admin "Orders" page (in-store POS). Reads product data from
 * Products.js (PRODUCTS / CATEGORIES). Drafts stay in the browser; prices,
 * completed checkouts and ingredient movements are validated by the backend.
 *
 * Each product's raw `options` (Size, Ice Level, Flavors, etc.) come
 * straight from the real menu data in Products.js. getPopoverOptions()
 * below decides which of those to actually show at the POS and adds
 * Add-ons the same way Menu.js does for customers - see that function
 * for details.
 */

const categoryListEl = document.getElementById("categoryList");
const productGridEl = document.getElementById("productGrid");
const productSearchEl = document.getElementById("productSearch");
const orderItemsEl = document.getElementById("orderItems");
const orderEmptyMsg = document.getElementById("orderEmptyMsg");
const subtotalAmountEl = document.getElementById("subtotalAmount");
const discountAmountEl = document.getElementById("discountAmount");
const orderTotalEl = document.getElementById("orderTotal");
const orderNumberEl = document.getElementById("orderNumber");
const customerNameEl = document.getElementById("customerName");
const addDiscountBtn = document.getElementById("addDiscountBtn");
const cancelOrderBtn = document.getElementById("cancelOrderBtn");
const placeOrderBtn = document.getElementById("placeOrderBtn");
const paymentExtraEl = document.getElementById("paymentExtra");
const productCardTemplate = document.getElementById("productCardTemplate");
const orderItemTemplate = document.getElementById("orderItemTemplate");
const posVoucherCode = document.getElementById("posVoucherCode");
const posVoucherStatus = document.getElementById("posVoucherStatus");
let posQuoteVersion = 0;

const ORDER_SEQ_KEY = "kopi_admin_next_order_no";
const OPERATIONS_ORDERS_KEY = "kopi_admin_operations_orders";

// Inline SVG cup icon used as a fallback if a product image fails to load
// (e.g. a typo'd filename, or an image not yet added to Customer/Menu/) -
// keeps the grid looking intentional instead of showing broken-image icons.
const PLACEHOLDER_IMG = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
     <rect width="64" height="64" fill="#f3ead8"/>
     <path d="M18 24h22v14a11 11 0 0 1-11 11 11 11 0 0 1-11-11V24z" fill="none" stroke="#c9b791" stroke-width="3"/>
     <path d="M40 27h4a6 6 0 0 1 0 12h-4" fill="none" stroke="#c9b791" stroke-width="3"/>
     <line x1="14" y1="49" x2="46" y2="49" stroke="#c9b791" stroke-width="3"/>
   </svg>`
);

function withImageFallback(img) {
  img.addEventListener("error", () => {
    img.onerror = null;
    img.src = PLACEHOLDER_IMG;
  }, { once: true });
  return img;
}

function getPopoverOptions(product) { return product.options; }

function unitPriceFromSelections(product, options, selections) {
  const priceKeyOption = options.find(option => option.priceKey);
  const base = priceKeyOption
    ? (product.prices[selections[priceKeyOption.key]] ?? Object.values(product.prices)[0])
    : Object.values(product.prices)[0];

  const addOnTotal = options.reduce((total, option) => {
    return total + (option.addOnPrice && selections[option.key] ? option.addOnPrice : 0);
  }, 0);

  return base + addOnTotal;
}

const state = {
  activeCategory: "all",
  view: "grid",
  searchTerm: "",
  cart: [],           // [{ cartId, productId, name, image, priceLabel, price, quantity }]
  orderType: "Dine-in",
  discount: 0,
  voucher: "",
  voucherQuote: null,
  paymentMethod: "Cash"
};

init();
const recoverPosBtn=document.createElement("button");
recoverPosBtn.type="button";
recoverPosBtn.className="place-order-btn recover-pos-btn";
recoverPosBtn.textContent="Recover previous order";
recoverPosBtn.hidden=!KopiApi.hasPendingOrder("/admin/orders");
placeOrderBtn.after(recoverPosBtn);
recoverPosBtn.addEventListener("click",async()=>{
  if (!window.confirm("Check the previous checkout. If it was not saved, retry its original items and payment details without creating a second order. Continue?")) return;
  recoverPosBtn.disabled=true;
  try {
    const result=await KopiApi.recoverOrder("/admin/orders");
    KopiNotice.toast(result.orderNumber+" — "+result.status+". Your current draft has been kept; check Operations before placing it again.");
    KopiApi.finishOrder("/admin/orders");
    recoverPosBtn.hidden=true;
  } catch(error) { KopiNotice.toast(error.message, "error"); }
  finally { recoverPosBtn.disabled=false; }
});

function init() {
  renderCategoryList();
  renderProducts();
  renderOrder();
  orderNumberEl.textContent = "# New";

  productSearchEl.addEventListener("input", () => {
    state.searchTerm = productSearchEl.value.trim().toLowerCase();
    renderProducts();
  });

  document.querySelectorAll(".view-btn").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".view-btn").forEach(b => b.classList.remove("active"));
      button.classList.add("active");
      state.view = button.dataset.view;
      productGridEl.classList.toggle("list-mode", state.view === "list");
    });
  });

  document.querySelectorAll(".order-type-btn").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".order-type-btn").forEach(b => b.classList.remove("active"));
      button.classList.add("active");
      state.orderType = button.dataset.type;
      renderOrder();
    });
  });

  document.querySelectorAll(".payment-btn").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".payment-btn").forEach(b => b.classList.remove("active"));
      button.classList.add("active");
      state.paymentMethod = button.dataset.method;
      renderPaymentExtra();
    });
  });

  addDiscountBtn.addEventListener("click", () => {
    const input = window.prompt("Enter discount amount in pesos:", state.discount || "");
    if (input === null) return;
    const value = Math.max(0, Number(input) || 0);
    if (value > 0 && state.voucher) {
      KopiNotice.toast("Clear the voucher before adding a manual discount.", "warning");
      return;
    }
    state.discount = value;
    renderOrder();
  });

  posVoucherCode.addEventListener("input", () => {
    state.voucher = "";
    renderOrder();
    posVoucherStatus.textContent = posVoucherCode.value.trim() ? "Click Apply to validate this code." : "";
  });
  document.getElementById("applyPosVoucher").addEventListener("click", () => {
    if (state.discount > 0 && posVoucherCode.value.trim()) {
      KopiNotice.set(posVoucherStatus, "Set the manual discount to zero before applying a voucher.", "warning");
      return;
    }
    state.voucher = posVoucherCode.value.trim().toUpperCase();
    posVoucherCode.value = state.voucher;
    renderOrder();
  });

  cancelOrderBtn.addEventListener("click", () => {
    if (!state.cart.length && !customerNameEl.value.trim()) return;
    const confirmed = window.confirm("Cancel this order? All items will be cleared.");
    if (!confirmed) return;
    resetOrder();
  });

  placeOrderBtn.addEventListener("click", placeOrder);
}

/* ---------- Categories ---------- */
function renderCategoryList() {
  const [allCategory, ...restCategories] = CATEGORIES;

  categoryListEl.innerHTML = `
    <button type="button" class="category-all-btn ${allCategory.id === state.activeCategory ? "active" : ""}" data-category="${allCategory.id}">
      <i class="bi ${allCategory.icon}"></i>
      <span>${allCategory.label}</span>
    </button>
    ${restCategories.map(category => `
      <button type="button" class="category-item ${category.id === state.activeCategory ? "active" : ""}" data-category="${category.id}">
        <i class="bi ${category.icon}"></i>
        <span>${category.label}</span>
      </button>
    `).join("")}
  `;

  categoryListEl.querySelectorAll(".category-item, .category-all-btn").forEach(button => {
    button.addEventListener("click", () => {
      state.activeCategory = button.dataset.category;
      syncCategoryButtons();
      renderProducts();
    });
  });
}

function syncCategoryButtons() {
  categoryListEl.querySelectorAll(".category-item, .category-all-btn").forEach(button => {
    button.classList.toggle("active", button.dataset.category === state.activeCategory);
  });
}

/* ---------- Products grid ---------- */
function renderProducts() {
  const filtered = PRODUCTS.filter(product => {
    const matchesCategory = state.activeCategory === "all" || product.category === state.activeCategory;
    const matchesSearch = !state.searchTerm || product.name.toLowerCase().includes(state.searchTerm);
    return matchesCategory && matchesSearch;
  });

  if (!filtered.length) {
    const message = state.searchTerm
      ? "No products match your search."
      : "No products in this category yet. Add them once Menu.html data is connected.";
    productGridEl.innerHTML = `<p class="category-empty">${message}</p>`;
    return;
  }

  productGridEl.innerHTML = filtered.map(renderProductCard).join("");

  productGridEl.querySelectorAll(".pos-product-card").forEach(card => {
    card.addEventListener("click", () => handleProductClick(card.dataset.productId, card));
  });
}

function renderProductCard(product) {
  const node = productCardTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.productId = product.id;
  const img = withImageFallback(node.querySelector("img"));
  img.src = product.image;
  img.alt = product.name;
  node.querySelector("[data-product-name]").textContent = product.name;
  node.querySelector("[data-product-price]").textContent = formatPriceLabel(product.prices);
  return node.outerHTML;
}

function formatPriceLabel(prices) {
  const entries = Object.entries(prices);
  if (entries.length === 1) return `₱${entries[0][1].toFixed(2)}`;
  return entries.map(([label, price]) => `${label} ₱${price}`).join(" | ");
}

/* ---------- Adding to order ---------- */
function handleProductClick(productId, cardEl) {
  const product = findProductById(productId);
  if (!product) return;

  const priceEntries = Object.entries(product.prices);
  const options = getPopoverOptions(product);
  // A lone priceKey group with only one possible value (e.g. Frappe items,
  // which only ever come in 16oz) isn't a real choice - skip the popover
  // for those and add straight to the order, same as before.
  const meaningfulOptions = options.filter(option => !(option.priceKey && option.values.length <= 1));

  if (priceEntries.length === 1 && meaningfulOptions.length === 0) {
    addToCart(product, priceEntries[0][0], priceEntries[0][1]);
    return;
  }

  openOptionsPopover(product, cardEl, options, meaningfulOptions);
}

function openOptionsPopover(product, anchorEl, options, meaningfulOptions) {
  document.querySelectorAll(".size-popover").forEach(el => el.remove());

  const selections = {};
  options.forEach(option => {
    // Add-ons are always optional, even when a category only has one add-on
    // choice (e.g. Syrup-Sauce) - never auto-select them.
    selections[option.key] = option.addOnPrice
      ? null
      : option.defaultValue ?? (option.values.length === 1 ? option.values[0] : null);
  });

  const popover = document.createElement("div");
  popover.className = "size-popover";

  function positionPopover() {
    const anchor = anchorEl.getBoundingClientRect();
    const bounds = popover.getBoundingClientRect();
    // Keep the options and Add to Order button inside the visible screen.
    popover.style.left = `${Math.max(12, Math.min(anchor.left, document.documentElement.clientWidth - bounds.width - 12))}px`;
    popover.style.top = `${Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - bounds.height - 12))}px`;
  }

  function renderPopover() {
    const total = unitPriceFromSelections(product, options, selections);

    popover.innerHTML = `
      <div class="popover-heading">${product.name}</div>
      ${meaningfulOptions.map(option => `
        <div class="popover-group">
          <div class="popover-group-label">${option.label}</div>
          <div class="popover-pill-row">
            ${option.values.map(value => `
              <button type="button"
                class="popover-pill ${selections[option.key] === value ? "active" : ""}"
                data-key="${option.key}" data-value="${value}">
                ${value}${option.priceKey ? ` · ₱${product.prices[value]}` : ""}${option.addOnPrice ? ` (+₱${option.addOnPrice})` : ""}
              </button>
            `).join("")}
          </div>
        </div>
      `).join("")}
      <div class="popover-footer">
        <strong class="popover-total">₱${total.toFixed(2)}</strong>
        <button type="button" class="popover-add-btn">Add to Order</button>
      </div>
    `;

    popover.querySelectorAll(".popover-pill").forEach(pill => {
      pill.addEventListener("click", event => {
        event.stopPropagation();
        const option = options.find(o => o.key === pill.dataset.key);
        const isDeselectingAddon = option.addOnPrice && selections[option.key] === pill.dataset.value;
        selections[option.key] = isDeselectingAddon ? null : pill.dataset.value;
        renderPopover();
      });
    });

    popover.querySelector(".popover-add-btn").addEventListener("click", event => {
      event.stopPropagation();
      const priceKeyOption = options.find(o => o.priceKey);
      if (priceKeyOption && !selections[priceKeyOption.key]) {
        KopiNotice.toast(`Please select ${priceKeyOption.label.toLowerCase()} first.`);
        return;
      }
      const priceLabel = priceKeyOption ? selections[priceKeyOption.key] : Object.keys(product.prices)[0];
      const finalPrice = unitPriceFromSelections(product, options, selections);
      const extraOptions = {};
      options.forEach(option => {
        if (option.priceKey) return;
        if (selections[option.key]) extraOptions[option.label] = selections[option.key];
      });
      addToCart(product, priceLabel, finalPrice, extraOptions);
      popover.remove();
    });

    if (popover.isConnected) positionPopover();
  }

  renderPopover();

  document.body.appendChild(popover);
  positionPopover();

  setTimeout(() => {
    document.addEventListener("click", function outsideClick(event) {
      if (!popover.contains(event.target)) {
        popover.remove();
        document.removeEventListener("click", outsideClick);
      }
    });
  }, 0);
}

function addToCart(product, priceLabel, price, options = {}) {
  const priceOption = product.options.find(option => option.priceKey);
  if (priceOption) options = { ...options, [priceOption.label]: priceLabel };
  const signature = JSON.stringify({ productId: product.id, priceLabel, options });
  const existing = state.cart.find(item => cartItemSignature(item) === signature);

  if (existing) {
    existing.quantity += 1;
  } else {
    state.cart.push({
      cartId: `${product.id}-${priceLabel}-${Date.now()}`,
      productId: product.id,
      name: product.name,
      image: product.image,
      priceLabel,
      price,
      quantity: 1,
      options
    });
  }
  renderOrder();
}

function cartItemSignature(item) {
  return JSON.stringify({ productId: item.productId, priceLabel: item.priceLabel, options: item.options || {} });
}

/* ---------- Order panel ---------- */
function renderOrder() {
  const version = ++posQuoteVersion;
  state.voucherQuote = null;
  if (!state.cart.length) {
    orderItemsEl.innerHTML = "";
    orderItemsEl.appendChild(orderEmptyMsg);
  } else {
    orderItemsEl.innerHTML = "";
    state.cart.forEach(item => orderItemsEl.appendChild(renderOrderItem(item)));
  }

  const subtotal = state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = Math.min(state.discount, subtotal);
  const total = Math.max(0, subtotal - discount);

  subtotalAmountEl.textContent = formatMoney(subtotal);
  discountAmountEl.textContent = formatMoney(discount);
  orderTotalEl.textContent = formatMoney(total);
  document.getElementById("posVoucherLine").hidden = !state.voucher;
  document.getElementById("posVoucherAmount").textContent = "₱0.00";
  placeOrderBtn.disabled = state.cart.length === 0 || Boolean(posVoucherCode.value.trim());
  if (state.voucher && state.cart.length) refreshPosVoucher(version);
  else if (state.voucher) posVoucherStatus.textContent = "Add an item to check this voucher.";
  else if (!posVoucherCode.value.trim()) posVoucherStatus.textContent = "";
}

async function refreshPosVoucher(version) {
  KopiNotice.set(posVoucherStatus, "Checking voucher…", "loading");
  try {
    const quote = await KopiApi.request("/admin/orders/quote", {
      method: "POST",
      body: JSON.stringify({items: state.cart, discount: state.discount, voucher: state.voucher, serviceType: state.orderType})
    });
    if (version !== posQuoteVersion) return;
    state.voucherQuote = quote;
    subtotalAmountEl.textContent = formatMoney(quote.subtotal);
    document.getElementById("posVoucherAmount").textContent = "− " + formatMoney(quote.voucherDiscount);
    orderTotalEl.textContent = formatMoney(quote.total);
    KopiNotice.set(posVoucherStatus, `${quote.voucher} applied: ${formatMoney(quote.voucherDiscount)} off.`, "success");
    placeOrderBtn.disabled = false;
  } catch (error) {
    if (version !== posQuoteVersion) return;
    state.voucherQuote = null;
    placeOrderBtn.disabled = true;
    KopiNotice.set(posVoucherStatus, error.message, "error");
  }
}

function renderOrderItem(item) {
  const node = orderItemTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.cartId = item.cartId;
  const img = withImageFallback(node.querySelector("img"));
  img.src = item.image;
  img.alt = item.name;
  node.querySelector("[data-item-name]").textContent = item.name;
  node.querySelector("[data-item-price]").textContent = formatOrderItemLine(item);
  node.querySelector("[data-item-qty]").textContent = item.quantity;

  node.querySelector("[data-action='inc']").addEventListener("click", () => changeQuantity(item.cartId, 1));
  node.querySelector("[data-action='dec']").addEventListener("click", () => changeQuantity(item.cartId, -1));
  node.querySelector("[data-action='delete']").addEventListener("click", () => removeFromCart(item.cartId));

  return node;
}

function changeQuantity(cartId, delta) {
  const item = state.cart.find(entry => entry.cartId === cartId);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) {
    removeFromCart(cartId);
    return;
  }
  renderOrder();
}

function removeFromCart(cartId) {
  state.cart = state.cart.filter(entry => entry.cartId !== cartId);
  renderOrder();
}

function formatOrderItemLine(item) {
  const extras = item.options && Object.keys(item.options).length
    ? " · " + Object.values(item.options).join(" · ")
    : "";
  return `${item.priceLabel} - ${formatMoney(item.price)}${extras}`;
}

/* ---------- Payment ---------- */
function renderPaymentExtra() {
  if (state.paymentMethod === "GCash") {
    paymentExtraEl.hidden = false;
    paymentExtraEl.innerHTML = `<input type="text" id="gcashRef" placeholder="Enter GCash reference number">`;
  } else {
    paymentExtraEl.hidden = true;
    paymentExtraEl.innerHTML = "";
  }
}

/* ---------- Place / cancel order ---------- */
async function placeOrder() {
  if (!state.cart.length || placeOrderBtn.disabled) return;

  if (!KopiApi.getSession()) {
    KopiNotice.toast("Please log in as an administrator first.");
    window.location.href = "../login.html";
    return;
  }

  placeOrderBtn.disabled = true;
  const checkoutSurface = document.querySelector("main");
  if (checkoutSurface) checkoutSurface.inert = true;

  try {
    const quote = await KopiApi.request("/admin/orders/quote", {
      method: "POST",
      body: JSON.stringify({items:state.cart,discount:state.discount,voucher:state.voucher,serviceType:state.orderType})
    });
    const displayedTotal = state.voucherQuote?.total ?? (state.cart.reduce((sum,item)=>sum+item.price*item.quantity,0)-Math.min(state.discount,state.cart.reduce((sum,item)=>sum+item.price*item.quantity,0)));
    if (Math.abs(displayedTotal-quote.total)>0.001) {
      state.cart = quote.items.map((item,index)=>({...state.cart[index],...item}));
      renderOrder();
      KopiNotice.toast("Prices have been updated. Review the new total and place the order again.");
      return;
    }
    const gcash = state.paymentMethod === "GCash";
    const reference = document.getElementById("gcashRef")?.value.trim() || "";
    if (gcash && !/^[0-9]{6,30}$/.test(reference)) throw new Error("Enter the GCash reference number.");
    if (gcash && !window.confirm(`Have you received ${formatMoney(quote.total)} with reference ${reference} in the shop GCash account?`)) return;
    const result = await KopiApi.placeOrder("/admin/orders", {
        customerName: customerNameEl.value.trim() || "Walk-in Customer",
        serviceType: state.orderType,
        payment: state.paymentMethod,
        discount: state.discount,
        voucher: state.voucher,
        paymentReference: reference,
        confirmedReceived: gcash,
        expectedTotal: quote.total,
        items: state.cart.map(item => ({
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          options: item.options || {}
        }))
    });

    KopiNotice.toast(`${result.orderNumber} is now preparing.`);
    KopiApi.finishOrder("/admin/orders");
    resetOrder();
  } catch (error) {
    if (state.voucher) state.voucherQuote = null;
    KopiNotice.toast(error.message || "Could not place the in-store order.", "error");
  } finally {
    if (checkoutSurface) checkoutSurface.inert = false;
    placeOrderBtn.disabled = state.cart.length === 0 || Boolean(posVoucherCode.value.trim() && !state.voucherQuote);
    recoverPosBtn.hidden = !KopiApi.hasPendingOrder("/admin/orders");
  }
}

function resetOrder() {
  state.cart = [];
  state.discount = 0;
  state.voucher = "";
  state.voucherQuote = null;
  posVoucherCode.value = "";
  state.orderType = "Dine-in";
  state.paymentMethod = "Cash";


  customerNameEl.value = "";
  document.querySelectorAll(".order-type-btn").forEach(b => b.classList.toggle("active", b.dataset.type === "Dine-in"));
  document.querySelectorAll(".payment-btn").forEach(b => b.classList.toggle("active", b.dataset.method === "Cash"));
  renderPaymentExtra();
  orderNumberEl.textContent = "# New";
  renderOrder();
}

/* ---------- Helpers ---------- */
function getOrderNumber() {
  const stored = Number(localStorage.getItem(ORDER_SEQ_KEY));
  return stored && stored > 0 ? stored : 1187;
}

function setOrderNumber(value) {
  localStorage.setItem(ORDER_SEQ_KEY, String(value));
}

function formatMoney(value) {
  return `₱${Number(value).toFixed(2)}`;
}
