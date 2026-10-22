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

const MAX_LINE_QUANTITY = 100;
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
// Senior Citizen / PWD details sent with the last verified quote.
let specialDiscountApplied = null;
let gcashProofData = "";
let idProofData = "";
let cashOnDeliveryRule = null;
let activeSpecialDiscount = null;
const specialDiscountToggle = document.getElementById("specialDiscountToggle");
const specialDiscountFields = document.getElementById("specialDiscountFields");
const specialDiscountType = document.getElementById("specialDiscountType");
const specialDiscountId = document.getElementById("specialDiscountId");
const specialDiscountName = document.getElementById("specialDiscountName");

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

// Larger online orders must be prepaid by GCash (server rule in orderSafety.js).
function syncCashOnDelivery() {
  const blocked = Boolean(cashOnDeliveryRule && cashOnDeliveryRule.allowed === false);
  const cashChoice = paymentChoices.querySelector('[data-payment="Cash"]');
  if (cashChoice) cashChoice.disabled = blocked;
  if (blocked && selectedPayment === "Cash") {
    orderNowBtn.disabled = true;
    KopiNotice.set(document.getElementById("checkoutQuoteStatus"), cashOnDeliveryRule.message, "warning");
  }
}

paymentChoices.querySelectorAll("[data-payment]").forEach(button => {
  button.addEventListener("click", () => {
    if (button.dataset.payment === "GCash" && !quoteReady) return;
    if (button.dataset.payment === "Cash" && cashOnDeliveryRule?.allowed === false) return;
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
    if (quoteReady) {
      orderNowBtn.disabled = selectedPayment === "Cash" && cashOnDeliveryRule?.allowed === false;
      if (isGcash) document.getElementById("checkoutQuoteStatus").textContent = "";
    }
  });
});

// GCash receipt screenshot and Senior Citizen / PWD ID photo are shrunk in the
// browser before upload.
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      let width = image.naturalWidth, height = image.naturalHeight;
      const scale = Math.min(1, 1100 / Math.max(width, height));
      width = Math.round(width * scale); height = Math.round(height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(image, 0, 0, width, height);
      for (const quality of [0.8, 0.65, 0.5, 0.4]) {
        const data = canvas.toDataURL("image/jpeg", quality);
        if (data.length <= 350000) return resolve(data);
      }
      reject(new Error("This image is too large. Please crop it and try again."));
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file could not be read as an image.")); };
    image.src = url;
  });
}

// GCash Ref. No.: 13 digits, numbers only.
gcashReference.addEventListener("input", () => {
  const digits = gcashReference.value.replace(/\D/g, "").slice(0, 13);
  if (digits !== gcashReference.value) gcashReference.value = digits;
});

const gcashProofInput = document.getElementById("gcashProof");
if (gcashProofInput) {
  gcashProofInput.addEventListener("change", async () => {
    const file = gcashProofInput.files?.[0];
    const status = document.getElementById("gcashProofStatus");
    gcashProofData = "";
    document.getElementById("gcashProofPreview").hidden = true;
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 12 * 1024 * 1024) {
      KopiNotice.set(status, "Choose a JPG, PNG or WebP image under 12 MB.", "error");
      gcashProofInput.value = "";
      return;
    }
    status.textContent = "Preparing screenshot…";
    try {
      gcashProofData = await shrinkImage(file);
      document.getElementById("gcashProofImage").src = gcashProofData;
      document.getElementById("gcashProofPreview").hidden = false;
      status.textContent = "Screenshot attached. Staff still confirm the payment in the shop's GCash account.";
    } catch (error) {
      gcashProofInput.value = "";
      KopiNotice.set(status, error.message, "error");
    }
  });
  document.getElementById("removeGcashProof").addEventListener("click", () => {
    gcashProofData = "";
    gcashProofInput.value = "";
    document.getElementById("gcashProofPreview").hidden = true;
    document.getElementById("gcashProofStatus").textContent = "Helps our staff find your payment faster.";
    gcashProofInput.focus();
  });
}

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

function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function specialDiscountInput() {
  return {
    type: specialDiscountType.value === "PWD" ? "PWD" : "Senior Citizen",
    idNumber: specialDiscountId.value.trim(),
    name: specialDiscountName.value.trim()
  };
}

function specialDiscountChanged(message) {
  ++quoteVersion;
  invalidateCheckoutQuote();
  document.getElementById("checkoutQuoteStatus").textContent = message;
}

if (specialDiscountToggle) {
  specialDiscountToggle.addEventListener("change", () => {
    specialDiscountFields.hidden = !specialDiscountToggle.checked;
    specialDiscountId.required = specialDiscountToggle.checked;
    specialDiscountName.required = specialDiscountToggle.checked;
    if (!specialDiscountToggle.checked) {
      document.getElementById("specialDiscountVerified").hidden = true;
      if (specialDiscountApplied) { specialDiscountApplied = null; refreshCheckoutQuote(); }
      return;
    }
    if (voucherCode.value.trim()) KopiNotice.toast("The Senior Citizen/PWD discount cannot be combined with a voucher. Remove the voucher first.", "warning");
    specialDiscountId.focus();
  });
  // Format guides: PWD IDs follow RR-PPMM-BBB-NNNNNNN; OSCA numbers vary by city.
  const syncIdHint = () => {
    const pwd = specialDiscountType.value === "PWD";
    specialDiscountId.placeholder = pwd ? "e.g. 04-3405-012-0001234" : "e.g. OSCA-CAL-2016-00123";
    specialDiscountId.inputMode = pwd ? "numeric" : "text";
    document.getElementById("specialDiscountIdHint").textContent = pwd
      ? "PWD ID format: RR-PPMM-BBB-NNNNNNN (region, province, city, barangay, number). Numbers only; dashes are added for you."
      : "OSCA control number exactly as printed on your Senior Citizen ID.";
  };
  specialDiscountType.addEventListener("change", syncIdHint);
  specialDiscountId.addEventListener("input", () => {
    if (specialDiscountType.value !== "PWD") return;
    const digits = specialDiscountId.value.replace(/\D/g, "").slice(0, 16);
    const parts = [digits.slice(0, 2), digits.slice(2, 6), digits.slice(6, 9), digits.slice(9)].filter(Boolean);
    specialDiscountId.value = parts.join("-");
  });
  const discountDetailsChanged = () => {
    document.getElementById("specialDiscountVerified").hidden = true;
    if (!specialDiscountApplied) return;
    specialDiscountApplied = null;
    specialDiscountChanged("Discount details changed. Click Apply discount to check the total before placing your order or sending payment.");
  };
  [specialDiscountType, specialDiscountId, specialDiscountName].forEach(field => field.addEventListener("input", discountDetailsChanged));
  // Photo of the Senior Citizen / PWD ID. Staff compare it with the details
  // typed above before the order is prepared, the same way GCash is checked.
  const idProofInput = document.getElementById("specialDiscountProof");
  const idProofStatus = document.getElementById("specialDiscountProofStatus");
  const idProofIdle = "Take a clear photo of the front of the ID. The name and ID number must be readable.";
  const clearIdProof = () => {
    idProofData = "";
    idProofInput.value = "";
    document.getElementById("specialDiscountProofPreview").hidden = true;
    idProofStatus.textContent = idProofIdle;
  };
  idProofInput.addEventListener("change", async () => {
    const file = idProofInput.files?.[0];
    idProofData = "";
    document.getElementById("specialDiscountProofPreview").hidden = true;
    discountDetailsChanged();
    if (!file) { idProofStatus.textContent = idProofIdle; return; }
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 12 * 1024 * 1024) {
      idProofInput.value = "";
      KopiNotice.set(idProofStatus, "Choose a JPG, PNG or WebP photo under 12 MB.", "error");
      return;
    }
    idProofStatus.textContent = "Preparing photo…";
    try {
      idProofData = await shrinkImage(file);
      document.getElementById("specialDiscountProofImage").src = idProofData;
      document.getElementById("specialDiscountProofPreview").hidden = false;
      idProofStatus.textContent = "ID photo attached. Click Apply discount.";
    } catch (error) {
      idProofInput.value = "";
      KopiNotice.set(idProofStatus, error.message, "error");
    }
  });
  document.getElementById("removeSpecialDiscountProof").addEventListener("click", () => {
    clearIdProof();
    discountDetailsChanged();
    idProofInput.focus();
  });
  document.getElementById("applySpecialDiscountBtn").addEventListener("click", async event => {
    const details = specialDiscountInput();
    const status = document.getElementById("checkoutQuoteStatus");
    const result = document.getElementById("specialDiscountVerified");
    if (!details.idNumber || !details.name) {
      KopiNotice.set(status, "Enter the ID number and the name printed on the ID.", "error");
      (details.idNumber ? specialDiscountName : specialDiscountId).focus();
      return;
    }
    if (!idProofData) {
      KopiNotice.set(idProofStatus, "Upload a photo of the ID before applying the discount.", "error");
      idProofInput.focus();
      return;
    }
    const button = event.currentTarget;
    button.disabled = true;
    result.hidden = true;
    try {
      // The server checks the ID format and prices the discount. The photo is
      // verified by our staff after the order is placed.
      specialDiscountApplied = details;
      await refreshCheckoutQuote();
      if (!activeSpecialDiscount) throw new Error(status.textContent || "The discount could not be applied.");
      specialDiscountId.value = activeSpecialDiscount.idNumber;
      specialDiscountApplied = { ...details, idNumber: activeSpecialDiscount.idNumber };
      idProofStatus.textContent = "ID photo attached. Our staff will check it after you place the order.";
      result.className = "discount-verified";
      result.innerHTML = `<i class="bi bi-hourglass-split" aria-hidden="true"></i><span><strong>Discount applied · ID photo for staff checking</strong> · ${escapeText(details.name)} · ${escapeText(activeSpecialDiscount.type)} ID ${escapeText(activeSpecialDiscount.idNumber)}. Our staff will compare your ID photo with these details before preparing your order.</span>`;
      result.hidden = false;
    } catch (error) {
      specialDiscountApplied = null;
      result.className = "discount-verified is-denied";
      result.innerHTML = `<i class="bi bi-x-octagon-fill" aria-hidden="true"></i><span><strong>Not accepted</strong> · ${escapeText(error.message)}</span>`;
      result.hidden = false;
      if (quoteReady === false) refreshCheckoutQuote();
    } finally { button.disabled = false; }
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
          specialDiscount: specialDiscountApplied,
          specialDiscountProof: specialDiscountApplied ? idProofData : "",
          paymentProof: selectedPayment === "GCash" ? gcashProofData : "",
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
  placedOrder = { id:result.orderNumber,payment:result.payment,paymentReference:result.paymentReference||"",paymentStatus:result.paymentStatus,status:result.status,
    voucher:result.voucher||"",voucherDiscount:Number(result.voucherDiscount||0),specialDiscount:result.specialDiscount||null };
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
      body: JSON.stringify({ items: activeCheckoutItems, voucher: voucherCode.value.trim(), specialDiscount: specialDiscountApplied })
    });
    if (version !== quoteVersion || placedOrder) return;
    activeCheckoutItems = quote.items;
    activeTotals = { subtotal: quote.subtotal, delivery: quote.deliveryFee, total: quote.total };
    voucherDiscount = quote.voucherDiscount;
    activeSpecialDiscount = quote.specialDiscount || null;
    cashOnDeliveryRule = quote.cashOnDelivery || null;
    checkoutList.innerHTML = activeCheckoutItems.map(renderCheckoutItem).join("");
    updateCheckoutTotals(activeTotals);
    quoteReady = true;
    orderNowBtn.disabled = false;
    gcashChoice.disabled = false;
    gcashPanel.hidden = selectedPayment !== "GCash";
    status.textContent = activeSpecialDiscount
      ? `${activeSpecialDiscount.type} discount applied to ${activeSpecialDiscount.coveredItems.map(item => item.quantity + " " + item.name).join(" and ")}.`
      : "";
    syncCashOnDelivery();
  } catch (error) {
    if (version !== quoteVersion) return;
    activeSpecialDiscount = null;
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
  const special = verifiedTotals ? activeSpecialDiscount : null;
  document.getElementById("vatExemptLine").hidden = !special || !(special.vatExempt > 0);
  document.getElementById("specialDiscountLine").hidden = !special;
  if (special) {
    document.getElementById("vatExemptAmount").textContent = `- PHP ${formatMoney(special.vatExempt)}`;
    document.getElementById("specialDiscountLabel").textContent = `${special.type} discount (20%)`;
    document.getElementById("specialDiscountAmount").textContent = `- PHP ${formatMoney(special.discount)}`;
  }
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
  itemNode.querySelector("[data-cart-quantity]").textContent = String(item.quantity);
  itemNode.querySelector(".cart-qty").setAttribute("aria-label", `Quantity of ${item.name}`);
  const decrease = itemNode.querySelector("[data-action='decrease']");
  const increase = itemNode.querySelector("[data-action='increase']");
  decrease.setAttribute("aria-label", `Decrease ${item.name} quantity`);
  increase.setAttribute("aria-label", `Increase ${item.name} quantity`);
  // One cart line accepts 1 to 100 (the backend limit). Use Remove to delete it.
  if (item.quantity <= 1) decrease.setAttribute("disabled", "");
  if (item.quantity >= MAX_LINE_QUANTITY) increase.setAttribute("disabled", "");

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
    ? (["Verified", "Paid"].includes(placedOrder.paymentStatus) ? "Paid — GCash payment verified by staff." : "Payment awaiting staff verification. This receipt confirms your order, not your payment.")
    : placedOrder.paymentStatus === "Paid" ? "Paid — Cash payment received." : "Cash payment due on delivery.";
  if (placedOrder.status === "Canceled") document.getElementById("receiptPaymentStatus").textContent = "This order was canceled. Contact the shop if you already sent GCash payment.";
  receiptItems.innerHTML = "";
  receiptItems.appendChild(receiptHeadTemplate.content.firstElementChild.cloneNode(true));
  activeCheckoutItems.forEach(item => {
    const row = receiptRowTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector("[data-receipt-quantity]").textContent = `${item.quantity}X`;
    row.querySelector("[data-receipt-name]").textContent = item.name.toUpperCase();
    row.querySelector("[data-receipt-price]").textContent = `₱ ${formatMoney(item.price * item.quantity)}`;
    receiptItems.appendChild(row);
  });
  document.getElementById("receiptSubtotal").textContent = `₱ ${formatMoney(activeTotals.subtotal)}`;
  document.getElementById("receiptVoucherRow").hidden = placedOrder.voucherDiscount <= 0;
  document.getElementById("receiptVoucherCode").textContent = placedOrder.voucher ? `Voucher (${placedOrder.voucher})` : "Voucher deduction";
  document.getElementById("receiptVoucherDiscount").textContent = `− ₱ ${formatMoney(placedOrder.voucherDiscount)}`;
  const special = placedOrder.specialDiscount;
  document.getElementById("receiptVatExemptRow").hidden = !special || !(special.vatExempt > 0);
  document.getElementById("receiptSpecialRow").hidden = !special;
  document.getElementById("receiptSpecialHolder").hidden = !special;
  if (special) {
    document.getElementById("receiptVatExempt").textContent = `− ₱ ${formatMoney(special.vatExempt)}`;
    document.getElementById("receiptSpecialLabel").textContent = `${special.type} discount (20%)`;
    document.getElementById("receiptSpecialDiscount").textContent = `− ₱ ${formatMoney(special.discount)}`;
    document.getElementById("receiptSpecialHolder").textContent = `${special.type} ID ${special.idNumber} · ${special.name}. Our staff will verify your ID photo before preparing the order. Please show the same ID to the rider.`;
  }
  document.getElementById("receiptDeliveryRow").hidden = !activeTotals.delivery;
  document.getElementById("receiptDeliveryFee").textContent = `₱ ${formatMoney(activeTotals.delivery)}`;
  receiptTotal.textContent = `₱ ${formatMoney(activeTotals.total)}`;
  receiptModal.hidden = false;
}

function bindItemActions(root) {
  root.querySelectorAll("[data-action='increase'], [data-action='decrease']").forEach(button => {
    button.addEventListener("click", () => {
      const cartId = button.closest("[data-cart-id]").dataset.cartId;
      const item = KopiStore.getCart().find(entry => entry.cartId === cartId);
      if (!item) return;
      const step = button.dataset.action === "increase" ? 1 : -1;
      const quantity = Math.min(MAX_LINE_QUANTITY, Math.max(1, item.quantity + step));
      if (quantity === item.quantity) return;
      KopiStore.updateCartItem(cartId, { quantity });
      renderCart();
      // Keep keyboard focus on the same control after the list re-renders.
      const line = [...cartList.querySelectorAll("[data-cart-id]")].find(node => node.dataset.cartId === cartId);
      const same = line?.querySelector(`[data-action='${button.dataset.action}']`);
      (same && !same.disabled ? same : line?.querySelector(".cart-qty button:not([disabled])"))?.focus();
    });
  });

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
