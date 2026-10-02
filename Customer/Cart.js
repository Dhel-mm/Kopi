const cartView = document.getElementById("cartView");
const checkoutView = document.getElementById("checkoutView");
const cartList = document.getElementById("cartList");
const checkoutList = document.getElementById("checkoutList");
const cartTotal = document.getElementById("cartTotal");
const checkoutTotal = document.getElementById("checkoutTotal");
const checkoutBarTotal = document.getElementById("checkoutBarTotal");
const checkoutCount = document.getElementById("checkoutCount");
const checkoutBtn = document.getElementById("checkoutBtn");
const clearCartBtn = document.getElementById("clearCartBtn");
const orderNowBtn = document.getElementById("orderNowBtn");
const confirmationForm = document.getElementById("confirmationForm");
const referenceNumber = document.getElementById("referenceNumber");
const paymentMethodBtn = document.getElementById("paymentMethodBtn");
const paymentChoices = document.getElementById("paymentChoices");
const gcashPanel = document.getElementById("gcashPanel");
const gcashReference = document.getElementById("gcashReference");
const houseAddress = document.getElementById("houseAddress");
const voucherCode = document.getElementById("voucherCode");
const applyVoucherBtn = document.getElementById("applyVoucherBtn");
const subtotalAmount = document.getElementById("subtotalAmount");
const deliveryAmount = document.getElementById("deliveryAmount");
const voucherAmount = document.getElementById("voucherAmount");
const receiptModal = document.getElementById("receiptModal");
const closeReceiptBtn = document.getElementById("closeReceiptBtn");
const receiptOrderNo = document.getElementById("receiptOrderNo");
const receiptDate = document.getElementById("receiptDate");
const receiptItems = document.getElementById("receiptItems");
const receiptTotal = document.getElementById("receiptTotal");
const cartItemTemplate = document.getElementById("cartItemTemplate");
const emptyCartTemplate = document.getElementById("emptyCartTemplate");
const checkoutLineTemplate = document.getElementById("checkoutLineTemplate");
const emptyCheckoutTemplate = document.getElementById("emptyCheckoutTemplate");
const receiptHeadTemplate = document.getElementById("receiptHeadTemplate");
const receiptRowTemplate = document.getElementById("receiptRowTemplate");

const params = new URLSearchParams(window.location.search);
const isCheckout = params.get("checkout") === "1";
let voucherDiscount = 0;
let activeCheckoutItems = [];
let activeTotals = { subtotal: 0, delivery: 0, total: 0 };
let placedOrder = null;
let selectedPayment = "Cash";
let quoteVersion = 0;
let quoteReady = false;
let checkoutCartSnapshot = [];

if (isCheckout) {
  showCheckout();
} else {
  renderCart();
}

paymentMethodBtn.addEventListener("click", () => {
  paymentChoices.hidden = !paymentChoices.hidden;
  paymentMethodBtn.setAttribute("aria-expanded", String(!paymentChoices.hidden));
});

function closePaymentChoices() {
  paymentChoices.hidden = true;
  paymentMethodBtn.setAttribute("aria-expanded", "false");
}

paymentChoices.querySelectorAll("[data-payment]").forEach(button => {
  button.addEventListener("click", () => {
    if (button.dataset.payment === "GCash" && !quoteReady) return;
    selectedPayment = button.dataset.payment;
    const isGcash = selectedPayment === "GCash";
    document.getElementById("paymentMethodName").textContent = selectedPayment;
    const icon = document.getElementById("paymentMethodIcon");
    icon.src = isGcash ? "HomePic/gcash.png" : "HomePic/Cash.png";
    gcashPanel.hidden = !isGcash;
    gcashReference.disabled = !isGcash;
    gcashReference.required = isGcash;
    paymentChoices.querySelectorAll("[data-payment]").forEach(choice => {
      choice.setAttribute("aria-pressed", String(choice === button));
    });
    closePaymentChoices();
    paymentMethodBtn.focus();
  });
});

document.addEventListener("click", event => {
  if (!event.target.closest(".payment-picker")) closePaymentChoices();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !paymentChoices.hidden) {
    closePaymentChoices();
    paymentMethodBtn.focus();
  }
});

document.getElementById("copyGcashNumber").addEventListener("click", async () => {
  const status = document.getElementById("gcashCopyStatus");
  try {
    await navigator.clipboard.writeText("+639551778760");
    status.textContent = "GCash number copied.";
  } catch {
    status.textContent = "Please copy the number above: +639551778760";
  }
});

confirmationForm.addEventListener("submit", event => {
  event.preventDefault();
  if (!orderNowBtn.disabled) orderNowBtn.click();
});

checkoutBtn.addEventListener("click", () => {
  const cart = KopiStore.getCart();
  if (!cart.length) return;
  KopiStore.setCheckout(cart);
  window.location.href = "Cart.html?checkout=1";
});

clearCartBtn.addEventListener("click", () => {
  KopiStore.clearCart();
  renderCart();
});

if (applyVoucherBtn) {
  applyVoucherBtn.addEventListener("click", () => {
    const code = voucherCode.value.trim().toUpperCase();
    voucherCode.value = code;
    refreshCheckoutQuote();
  });
  voucherCode.addEventListener("input", () => {
    ++quoteVersion;
    invalidateCheckoutQuote();
    document.getElementById("checkoutQuoteStatus").textContent =
      "Voucher changed. Click Apply to check the total before placing your order or sending payment.";
  });
}

if (orderNowBtn) {
  orderNowBtn.addEventListener("click", async () => {
    if (!confirmationForm.reportValidity()) return;
    if (placedOrder || orderNowBtn.disabled || !quoteReady) return;

    if (!KopiApi.getSession()) {
      KopiNotice.toast("Please log in before placing an order.");
      window.location.href = "../login.html";
      return;
    }

    try {
      orderNowBtn.disabled = true;
      confirmationForm.inert = true;
      paymentMethodBtn.disabled = true;
      gcashReference.readOnly = true;
      KopiStore.setAddress(houseAddress.value.trim());

      const result = await KopiApi.placeOrder("/orders", {
          items: activeCheckoutItems,
          payment: selectedPayment,
          paymentReference: selectedPayment === "GCash" ? gcashReference.value.trim() : "",
          address: houseAddress.value.trim(),
          phone: referenceNumber.value.trim(),
          voucher: voucherCode.value.trim().toUpperCase(),
          expectedTotal: activeTotals.total,
          cartSnapshot: checkoutCartSnapshot
      });

      displaySavedOrder(result);
    } catch (error) {
      confirmationForm.inert = false;
      paymentMethodBtn.disabled = false;
      gcashReference.readOnly = false;
      syncCheckoutRecovery();
      refreshCheckoutQuote();
      KopiNotice.toast(error.message, "error");
    }
  });
}
if (closeReceiptBtn) {
  closeReceiptBtn.addEventListener("click", () => {
    receiptModal.hidden = true;
    KopiApi.finishOrder("/orders");
    KopiStore.consumeCheckout(checkoutCartSnapshot);
    KopiStore.setCheckout([]);
    window.location.href = "Menu.html";
  });
}

function renderCart() {
  const cart = KopiStore.getCart();
  const cartCount = KopiStore.cartCount(cart);
  cartView.hidden = false;
  checkoutView.hidden = true;
  cartList.dataset.count = `${cartCount} item${cartCount === 1 ? "" : "s"}`;

  if (!cart.length) {
    cartList.innerHTML = emptyCartTemplate.innerHTML;
    checkoutBtn.disabled = true;
  } else {
    cartList.innerHTML = cart.map(renderCartItem).join("");
    checkoutBtn.disabled = false;
  }

  cartTotal.textContent = `₱ ${formatWhole(KopiStore.cartTotal(cart))}`;
  bindItemActions(cartList);
  KopiStore.updateCartCount();
}

function showCheckout() {
  activeCheckoutItems = KopiStore.getCheckout();
  checkoutCartSnapshot = structuredClone(activeCheckoutItems);
  cartView.hidden = true;
  checkoutView.hidden = false;
  if (houseAddress) houseAddress.value = KopiStore.getAddress();

  checkoutList.innerHTML = activeCheckoutItems.length
    ? activeCheckoutItems.map(renderCheckoutItem).join("")
    : emptyCheckoutTemplate.innerHTML;

  checkoutCount.textContent = `${KopiStore.cartCount(activeCheckoutItems)} item${KopiStore.cartCount(activeCheckoutItems) === 1 ? "" : "s"}`;
  orderNowBtn.disabled = !activeCheckoutItems.length;
  updateCheckoutTotals();
  refreshCheckoutQuote();
  syncCheckoutRecovery();
}

function syncCheckoutRecovery() {
  document.getElementById("checkoutRecovery").hidden = !KopiApi.hasPendingOrder("/orders");
}

function displaySavedOrder(result) {
  activeCheckoutItems = result.items;
  activeTotals = { subtotal: result.subtotal, delivery: result.deliveryFee, total: result.total };
  placedOrder = { id:result.orderNumber,payment:result.payment,paymentReference:result.paymentReference||"",paymentStatus:result.paymentStatus,status:result.status };
  orderNowBtn.disabled = true;
  showReceipt();
}

document.getElementById("recoverCheckoutBtn").addEventListener("click",async event=>{
  const button=event.currentTarget;
  button.disabled=true;
  try {
    const pending=KopiApi.pendingOrder("/orders");
    const result=await KopiApi.recoverOrder("/orders");
    checkoutCartSnapshot=pending?.payload?.cartSnapshot||pending?.payload?.items||[];
    displaySavedOrder(result);
  } catch(error) {
    KopiNotice.toast(error.message, "error");
    syncCheckoutRecovery();
  } finally { button.disabled=false; }
});

function invalidateCheckoutQuote() {
  quoteReady = false;
  orderNowBtn.disabled = true;
  paymentChoices.querySelector('[data-payment="GCash"]').disabled = true;
  gcashPanel.hidden = true;
  document.getElementById("gcashAmount").textContent = "Checking…";
}

async function refreshCheckoutQuote() {
  const version = ++quoteVersion;
  invalidateCheckoutQuote();
  const gcashChoice = paymentChoices.querySelector('[data-payment="GCash"]');
  const status = document.getElementById("checkoutQuoteStatus");
  if (!activeCheckoutItems.length) { status.textContent = "No items selected."; return; }
  if (!KopiApi.getSession()) {
    status.textContent = "Please log in before checkout. Do not send payment yet.";
    return;
  }
  status.textContent = "Checking menu prices and ingredient availability…";
  try {
    const quote = await KopiApi.request("/orders/quote", {
      method: "POST",
      body: JSON.stringify({ items: activeCheckoutItems, voucher: voucherCode.value.trim() })
    });
    if (version !== quoteVersion || placedOrder) return;
    activeCheckoutItems = quote.items;
    activeTotals = { subtotal: quote.subtotal, delivery: quote.deliveryFee, total: quote.total };
    voucherDiscount = quote.voucherDiscount;
    checkoutList.innerHTML = activeCheckoutItems.map(renderCheckoutItem).join("");
    updateCheckoutTotals(activeTotals);
    quoteReady = true;
    orderNowBtn.disabled = false;
    gcashChoice.disabled = false;
    gcashPanel.hidden = selectedPayment !== "GCash";
    status.textContent = "";
  } catch (error) {
    if (version !== quoteVersion) return;
    KopiNotice.set(status,error.message,"error");
    document.getElementById("gcashAmount").textContent = "Unavailable";
  }
}

function updateCheckoutTotals(verifiedTotals) {
  const subtotal = verifiedTotals?.subtotal ?? KopiStore.cartTotal(activeCheckoutItems);
  const delivery = verifiedTotals?.delivery ?? 0;
  const total = verifiedTotals?.total ?? Math.max(0, subtotal + delivery - voucherDiscount);
  activeTotals = { subtotal, delivery, total };

  subtotalAmount.textContent = `PHP ${formatMoney(subtotal)}`;
  deliveryAmount.textContent = `PHP ${formatMoney(delivery)}`;
  voucherAmount.textContent = `- PHP ${formatMoney(voucherDiscount)}`;
  checkoutTotal.textContent = `₱ ${formatMoney(total)}`;
  checkoutBarTotal.textContent = `₱ ${formatMoney(total)}`;
  document.getElementById("gcashAmount").textContent = `₱ ${formatMoney(total)}`;
}

function renderCartItem(item) {
  const details = orderDetails(item);
  const itemNode = cartItemTemplate.content.firstElementChild.cloneNode(true);
  const image = itemNode.querySelector(".item-img");
  const detailsNode = itemNode.querySelector("[data-cart-details]");
  const editButton = itemNode.querySelector("[data-action='edit']");

  itemNode.dataset.cartId = item.cartId;
  image.src = item.image;
  image.alt = item.name;
  itemNode.querySelector("[data-cart-name]").textContent = item.name;
  itemNode.querySelector("[data-cart-price]").textContent = `₱ ${formatWhole(item.price * item.quantity)}`;
  itemNode.querySelector("[data-cart-quantity]").textContent = `x ${item.quantity}`;

  details.forEach(detail => {
    const detailLine = document.createElement("p");
    detailLine.textContent = detail;
    detailsNode.appendChild(detailLine);
  });

  if (!details.length) {
    editButton.replaceWith(document.createElement("span"));
  }

  return itemNode.outerHTML;
}

function renderCheckoutItem(item) {
  const line = checkoutLineTemplate.content.firstElementChild.cloneNode(true);
  line.dataset.cartId = item.cartId;
  line.querySelector("[data-checkout-name]").textContent = item.name;
  line.querySelector("[data-checkout-price]").textContent = `₱ ${formatWhole(item.price * item.quantity)}`;
  return line.outerHTML;
}

function orderDetails(item) {
  if (!item.options) return [item.temperature, item.size, item.sugar, item.ice].filter(Boolean);
  return Object.values(item.options).filter(Boolean);
}

function showReceipt() {
  const orderNo = `#${placedOrder?.id || "----"}`;
  const date = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).toUpperCase();

  receiptOrderNo.textContent = orderNo;
  receiptDate.textContent = date;
  document.getElementById("receiptPayment").textContent = placedOrder.payment;
  document.getElementById("receiptReferenceRow").hidden = placedOrder.payment !== "GCash";
  document.getElementById("receiptReference").textContent = placedOrder.paymentReference;
  document.getElementById("receiptPaymentStatus").textContent = placedOrder.payment === "GCash"
    ? (placedOrder.paymentStatus === "Verified" ? "GCash payment verified by staff." : "Payment awaiting staff verification. This receipt confirms your order, not your payment.")
    : "Cash payment due on delivery.";
  if (placedOrder.status === "Canceled") document.getElementById("receiptPaymentStatus").textContent = "This order was canceled. Contact the shop if you already sent GCash payment.";
  receiptItems.innerHTML = "";
  receiptItems.appendChild(receiptHeadTemplate.content.firstElementChild.cloneNode(true));
  activeCheckoutItems.forEach(item => {
    const row = receiptRowTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector("[data-receipt-quantity]").textContent = `${item.quantity}X`;
    row.querySelector("[data-receipt-name]").textContent = item.name.toUpperCase();
    row.querySelector("[data-receipt-price]").textContent = `₱ ${formatWhole(item.price * item.quantity)}`;
    receiptItems.appendChild(row);
  });
  receiptTotal.textContent = `₱ ${formatWhole(activeTotals.total)}`;
  receiptModal.hidden = false;
}

function bindItemActions(root) {
  root.querySelectorAll("[data-action='edit']").forEach(button => {
    button.addEventListener("click", () => {
      const cartId = button.closest("[data-cart-id]").dataset.cartId;
      window.location.href = `Menu.html?edit=${encodeURIComponent(cartId)}`;
    });
  });

  root.querySelectorAll("[data-action='delete']").forEach(button => {
    button.addEventListener("click", () => {
      const cartId = button.closest("[data-cart-id]").dataset.cartId;
      KopiStore.deleteCartItem(cartId);

      if (checkoutView.hidden) {
        renderCart();
      } else {
        KopiStore.setCheckout(KopiStore.getCheckout().filter(item => item.cartId !== cartId));
        showCheckout();
      }
    });
  });
}

function formatMoney(value) {
  return Number(value).toFixed(2);
}

function formatWhole(value) {
  return Math.round(Number(value)).toLocaleString("en-US");
}
