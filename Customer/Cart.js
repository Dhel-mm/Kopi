const cartView = document.getElementById("cartView");
const checkoutView = document.getElementById("checkoutView");
const cartList = document.getElementById("cartList");
const checkoutList = document.getElementById("checkoutList");
const cartTotal = document.getElementById("cartTotal");
const checkoutTotal = document.getElementById("checkoutTotal");
const checkoutBarTotal = document.getElementById("checkoutBarTotal");
const checkoutCount = document.getElementById("checkoutCount");
const checkoutBtn = document.getElementById("checkoutBtn");
const removeSelectedBtn = document.getElementById("removeSelectedBtn");
const selectAllCart = document.getElementById("selectAllCart");
const orderNowBtn = document.getElementById("orderNowBtn");
const confirmationForm = document.getElementById("confirmationForm");
const referenceNumber = document.getElementById("referenceNumber");
const paymentMethodBtn = document.getElementById("paymentMethodBtn");
const paymentChoices = document.getElementById("paymentChoices");
const gcashPanel = document.getElementById("gcashPanel");
const gcashReference = document.getElementById("gcashReference");
// Delivery address parts; the order gets them joined as one line.
const addressFields = {
  street: document.getElementById("addressStreet"),
  barangay: document.getElementById("addressBarangay"),
  city: document.getElementById("addressCity"),
  province: document.getElementById("addressProvince"),
  landmark: document.getElementById("addressLandmark")
};
const saveAddressBox = document.getElementById("saveAddress");

// Province → city/municipality → barangay, picked from the official list
// (PhLocations.js). Choosing one fills the next list. Nothing is chosen at first:
// a new account starts at "Choose province"; a saved address is filled in.
const locations = globalThis.KopiLocations || [];
// "City of Calamba", "Calamba" and "Calamba City" all find the same place.
const placeKey = value => String(value || "").toLowerCase().replace(/^city of /, "").replace(/ city$/, "").replace(/[^a-z0-9ñ]+/g, "");
function fillChoices(select, names, placeholder, chosen = "") {
  if (!select || select.tagName !== "SELECT") return;
  const match = names.find(name => placeKey(name) === placeKey(chosen)) || "";
  select.replaceChildren(new Option(placeholder, ""), ...names.map(name => new Option(name, name)));
  select.value = match;
  select.disabled = !names.length;
}
function chosenProvince() {
  return locations.find(province => province.name === addressFields.province?.value);
}
function chosenCity() {
  return chosenProvince()?.cities.find(city => city.name === addressFields.city?.value);
}
function fillCities(chosen = "") {
  fillChoices(addressFields.city, chosenProvince()?.cities.map(city => city.name) || [], "Choose city or municipality", chosen);
}
function fillBarangays(chosen = "") {
  fillChoices(addressFields.barangay, chosenCity()?.barangays || [], "Choose barangay", chosen);
}
// Shows a saved or typed address in the lists. Unknown places leave the list unchosen.
function setPlace({province = "", city = "", barangay = ""} = {}) {
  fillChoices(addressFields.province, locations.map(item => item.name), "Choose province", province);
  fillCities(city);
  fillBarangays(String(barangay).replace(/^(brgy\.?|barangay)\s+/i, ""));
}
addressFields.province?.addEventListener("change", () => { fillCities(); fillBarangays(); });
addressFields.city?.addEventListener("change", () => fillBarangays());
setPlace();
const timeAsap = document.getElementById("timeAsap");
const timeScheduled = document.getElementById("timeScheduled");
const timeDate = document.getElementById("timeDate");
const timeClock = document.getElementById("timeClock");
let scheduleOptions = null;
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
// Online orders are delivered, or picked up and paid at the store.
let orderType = "Delivery";
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

function paymentLabel() {
  if (selectedPayment === "GCash") return "GCash";
  return orderType === "Pickup" ? "Pay at store" : "COD (Cash on Delivery)";
}

function syncOrderType() {
  const pickup = orderType === "Pickup";
  const addressGroup = document.getElementById("addressGroup");
  if (addressGroup) addressGroup.hidden = pickup;
  // Hidden address fields must not block a pickup order.
  ["street", "barangay", "city", "province"].forEach(key => { if (addressFields[key]) addressFields[key].required = !pickup; });
  // Pickup has no rider, so the Lalamove delivery fee line is hidden.
  const feeLine = document.getElementById("deliveryFeeLine");
  if (feeLine) feeLine.hidden = pickup;
  const feeNote = document.getElementById("deliveryFeeNote");
  if (feeNote) feeNote.hidden = pickup;
  const pickupNote = document.getElementById("pickupNote");
  if (pickupNote) pickupNote.hidden = !pickup;
  const cashName = document.getElementById("cashChoiceName");
  if (cashName) cashName.textContent = pickup ? "Pay at store" : "COD (Cash on Delivery)";
  const cashHint = document.getElementById("cashChoiceHint");
  if (cashHint) cashHint.textContent = pickup ? "Pay at the counter when you pick up" : "Pay when your order arrives";
  document.getElementById("paymentMethodName").textContent = paymentLabel();
  renderTimeSlots();
}

// Pickup or rider handover time: priority, or a date and time the customer
// types. Only opening hours are accepted, and the server checks again.
function typedTime() {
  return timeDate?.value && timeClock?.value ? `${timeDate.value}T${timeClock.value}:00+08:00` : "";
}

// Explain a date or time outside opening hours before the order is sent.
function checkTypedTime() {
  if (!timeDate || !timeClock || !scheduleOptions) return;
  let dateMessage = "";
  let timeMessage = "";
  if (timeScheduled.checked && timeDate.value && new Date(`${timeDate.value}T12:00:00+08:00`).getUTCDay() === 1) {
    dateMessage = "We are closed on Mondays. Choose Tuesday to Sunday.";
  }
  if (timeScheduled.checked && timeClock.value && !dateMessage) {
    if (timeClock.value < scheduleOptions.openTime || timeClock.value > scheduleOptions.closeTime) {
      timeMessage = "Choose a time between 4:00 PM and 11:00 PM.";
    } else if (timeDate.value && new Date(typedTime()).getTime() < Date.now() + scheduleOptions.leadMinutes * 60000) {
      timeMessage = `Choose a time at least ${scheduleOptions.leadMinutes} minutes from now so we can prepare your order.`;
    }
  }
  timeDate.setCustomValidity?.(dateMessage);
  timeClock.setCustomValidity?.(timeMessage);
}

function renderTimeSlots() {
  const label = document.getElementById("timeSlotLabel");
  if (label) label.textContent = orderType === "Pickup" ? "Pickup time" : "Rider pickup time";
  const priorityLabel = document.getElementById("timeAsapLabel");
  if (priorityLabel) priorityLabel.textContent = priorityName(orderType);
  if (!timeAsap || !scheduleOptions) return;
  timeAsap.disabled = !scheduleOptions.asap;
  if (!scheduleOptions.asap) timeScheduled.checked = true;
  document.getElementById("timeInputs").hidden = !timeScheduled.checked;
  timeDate.min = scheduleOptions.minDate;
  timeDate.max = scheduleOptions.maxDate;
  timeClock.min = scheduleOptions.openTime;
  timeClock.max = scheduleOptions.closeTime;
  if (!timeDate.value && scheduleOptions.earliest) {
    timeDate.value = scheduleOptions.earliest.date;
    timeClock.value = scheduleOptions.earliest.time;
  }
  timeDate.required = timeScheduled.checked;
  timeClock.required = timeScheduled.checked;
  checkTypedTime();
  const who = orderType === "Pickup" ? "You can pick up orders" : "Riders collect orders";
  const note = document.getElementById("timeSlotNote");
  note.classList.toggle("is-closed", !scheduleOptions.asap);
  note.querySelector("span").textContent = scheduleOptions.asap
    ? `${who} only while we are open: ${scheduleOptions.hours}.`
    : `We are closed right now, so choose a date and time when we are open. ${who} only during opening hours: ${scheduleOptions.hours}.`;
}

[timeAsap, timeScheduled].forEach(input => input?.addEventListener("change", renderTimeSlots));
[timeDate, timeClock].forEach(input => input?.addEventListener("input", checkTypedTime));

async function loadSchedule() {
  if (!timeAsap) return;
  try {
    const options = await KopiApi.request("/orders/schedule");
    if (!options?.minDate) throw new Error("Invalid opening times");
    scheduleOptions = options;
    renderTimeSlots();
  } catch {
    const note = document.getElementById("timeSlotNote");
    if (note) note.querySelector("span").textContent = "Could not load opening hours. Refresh the page before ordering.";
  }
}

["orderTypeDelivery", "orderTypePickup"].forEach(id => {
  const input = document.getElementById(id);
  if (!input) return;
  input.addEventListener("change", () => {
    if (!input.checked || placedOrder) return;
    orderType = input.value === "Pickup" ? "Pickup" : "Delivery";
    syncOrderType();
    // The pay-at-store limit message differs from cash on delivery, so re-check.
    if (typeof refreshCheckoutQuote === "function" && isCheckout) refreshCheckoutQuote();
  });
});

// A browser may restore the Pickup choice when the customer comes back.
if (document.getElementById("orderTypePickup")?.checked) {
  orderType = "Pickup";
  syncOrderType();
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
    document.getElementById("paymentMethodName").textContent = paymentLabel();
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
      status.textContent = "Screenshot attached. Our cashier still confirms the payment in the shop's GCash account.";
    } catch (error) {
      gcashProofInput.value = "";
      KopiNotice.set(status, error.message, "error");
    }
  });
  document.getElementById("removeGcashProof").addEventListener("click", () => {
    gcashProofData = "";
    gcashProofInput.value = "";
    document.getElementById("gcashProofPreview").hidden = true;
    document.getElementById("gcashProofStatus").textContent = "Upload the screenshot of your GCash receipt. You cannot order by GCash without it.";
    gcashProofInput.focus();
  });
}

// Phone number: numbers only, up to 11 digits.
referenceNumber.addEventListener("input", () => {
  const digits = referenceNumber.value.replace(/\D/g, "").slice(0, 11);
  if (digits !== referenceNumber.value) referenceNumber.value = digits;
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

confirmationForm.addEventListener("submit", event => {
  event.preventDefault();
  if (!orderNowBtn.disabled) orderNowBtn.click();
});

function selectedCartItems() {
  const selected = new Set(KopiStore.getSelected());
  return KopiStore.getCart().filter(item => selected.has(item.cartId));
}

// Only the ticked items go to checkout. If the shop no longer has enough
// ingredients for them, the customer stays in the cart and sees why.
checkoutBtn.addEventListener("click", async () => {
  const items = selectedCartItems();
  if (!items.length) {
    KopiNotice.toast("Tick the items you want to check out.", "warning");
    return;
  }
  checkoutBtn.disabled = true;
  try {
    if (KopiApi.getSession()) {
      await KopiApi.request("/orders/quote", {method: "POST", body: JSON.stringify({items, serviceType: "Delivery"})});
    }
  } catch (error) {
    if (error.status === 409) {
      KopiNotice.toast(`Not enough ingredients. ${error.message} Please lower the quantity or untick the item.`, "warning");
      checkoutBtn.disabled = false;
      return;
    }
    if (error.status === 400) {
      KopiNotice.toast(error.message, "warning");
      checkoutBtn.disabled = false;
      return;
    }
    // Network trouble: the checkout page checks again before ordering.
  }
  KopiStore.setCheckout(items);
  window.location.href = "Cart.html?checkout=1";
});

removeSelectedBtn.addEventListener("click", async () => {
  const items = selectedCartItems();
  if (!items.length) return;
  const names = items.map(item => `${item.quantity} × ${item.name}`).join("\n");
  if (!await KopiNotice.confirm(names, {title: `Remove ${items.length === 1 ? "this item" : "these items"} from your cart?`, confirmText: "Remove", danger: true})) return;
  items.forEach(item => KopiStore.deleteCartItem(item.cartId));
  KopiStore.setSelected([]);
  renderCart();
});

selectAllCart.addEventListener("change", () => {
  KopiStore.setSelected(selectAllCart.checked ? KopiStore.getCart().map(item => item.cartId) : []);
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
    if (!await KopiNotice.confirm(`${details.type} discount for ${details.name}, ID ${details.idNumber}.\nOur staff will check your ID photo. If it cannot be verified, the discount is removed and the order continues at the normal price.`, {title: "Are you sure you want to apply this discount?", confirmText: "Apply discount", cancelText: "Go back"})) return;
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
    if (timeScheduled?.checked && !typedTime()) {
      KopiNotice.toast("Enter a date and time during our opening hours before ordering.", "warning");
      return;
    }

    if (!KopiApi.getSession()) {
      KopiNotice.toast("Please log in before placing an order.");
      window.location.href = "../login.html";
      return;
    }

    if (selectedPayment === "GCash" && !gcashProofData) {
      KopiNotice.set(document.getElementById("gcashProofStatus"), "Attach the screenshot of your GCash receipt before ordering.", "error");
      KopiNotice.toast("Attach the screenshot of your GCash receipt before ordering.", "error");
      document.getElementById("gcashProof")?.focus();
      return;
    }

    if (!await KopiNotice.confirm(orderSummaryText(), {title: "Are you sure you want to order these?", confirmText: "Yes, place order", cancelText: "Go back"})) return;
    if (placedOrder || orderNowBtn.disabled || !quoteReady) return;

    try {
      orderNowBtn.disabled = true;
      confirmationForm.inert = true;
      paymentMethodBtn.disabled = true;
      gcashReference.readOnly = true;
      if (orderType === "Delivery" && saveAddressBox?.checked) saveAccountAddress();

      const result = await KopiApi.placeOrder("/orders", {
          items: activeCheckoutItems,
          payment: selectedPayment,
          paymentReference: selectedPayment === "GCash" ? gcashReference.value.trim() : "",
          serviceType: orderType,
          timeSlot: timeScheduled?.checked ? typedTime() : "ASAP",
          address: orderType === "Pickup" ? "" : fullAddress(),
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
      // A chosen time may have passed while the page was open.
      loadSchedule();
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

// What the customer is asked to confirm: items, discounts, total and how they pay.
function orderSummaryText() {
  const lines = activeCheckoutItems.map(item => `${item.quantity} × ${item.name} — ₱ ${formatMoney(item.price * item.quantity)}`);
  if (voucherDiscount > 0) lines.push(`Voucher: − ₱ ${formatMoney(voucherDiscount)}`);
  if (activeSpecialDiscount) {
    lines.push(`${activeSpecialDiscount.type} discount and VAT exemption: − ₱ ${formatMoney(activeSpecialDiscount.deduction)}`);
  }
  lines.push(`Total: ₱ ${formatMoney(activeTotals.total)}`);
  lines.push(`Payment: ${paymentLabel()}`);
  lines.push(orderType === "Pickup" ? "Pickup at the store" : "Delivery · delivery fee is paid separately");
  return lines.join("\n");
}

function addressValues() {
  return Object.fromEntries(Object.entries(addressFields).map(([key, input]) => [key, input?.value.trim() || ""]));
}

// For example "72 Camia St., Brgy. Lingga, Calamba City, Laguna (Landmark: blue gate)".
function fullAddress() {
  const {street, barangay, city, province, landmark} = addressValues();
  const brgy = barangay && !/^(brgy|barangay)/i.test(barangay) ? "Brgy. " + barangay : barangay;
  return [street, brgy, city, province].filter(Boolean).join(", ") + (landmark ? " (Landmark: " + landmark + ")" : "");
}

// Fill the address saved on the account, so it is there again after logging in on any device.
async function loadSavedAddress() {
  const phone = KopiApi.getSession()?.user?.phone;
  if (phone && referenceNumber && !referenceNumber.value) referenceNumber.value = phone;
  if (!KopiApi.getSession() || !addressFields.street) return;
  try {
    const {address} = await KopiApi.request("/me/address");
    if (!address || addressFields.street.value.trim()) return;
    addressFields.street.value = address.street || "";
    if (addressFields.landmark) addressFields.landmark.value = address.landmark || "";
    setPlace(address);
    document.getElementById("addressSavedNote").hidden = false;
  } catch { /* The customer can still type the address. */ }
}

async function saveAccountAddress() {
  try { await KopiApi.request("/me/address", {method: "PUT", body: JSON.stringify(addressValues())}); }
  catch { /* The order is placed even if the address could not be saved. */ }
}

function renderCart() {
  const cart = KopiStore.getCart();
  const cartCount = KopiStore.cartCount(cart);
  cartView.hidden = false;
  checkoutView.hidden = true;
  cartList.dataset.count = `${cartCount} item${cartCount === 1 ? "" : "s"}`;

  if (!cart.length) {
    cartList.innerHTML = emptyCartTemplate.innerHTML;
  } else {
    cartList.innerHTML = cart.map(renderCartItem).join("");
  }

  bindItemActions(cartList);
  syncCartSelection();
  KopiStore.updateCartCount();
}

// The total, Checkout and Remove Selected only count the ticked items.
function syncCartSelection() {
  const cart = KopiStore.getCart();
  const items = selectedCartItems();
  cartTotal.textContent = `₱ ${formatWhole(KopiStore.cartTotal(items))}`;
  checkoutBtn.disabled = !items.length;
  checkoutBtn.textContent = items.length ? `Checkout (${items.length})` : "Checkout";
  removeSelectedBtn.disabled = !items.length;
  selectAllCart.disabled = !cart.length;
  selectAllCart.checked = cart.length > 0 && items.length === cart.length;
  selectAllCart.indeterminate = items.length > 0 && items.length < cart.length;
}

function showCheckout() {
  loadSchedule();
  activeCheckoutItems = KopiStore.getCheckout();
  checkoutCartSnapshot = structuredClone(activeCheckoutItems);
  cartView.hidden = true;
  checkoutView.hidden = false;
  loadSavedAddress();

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
    voucher:result.voucher||"",voucherDiscount:Number(result.voucherDiscount||0),specialDiscount:result.specialDiscount||null,
    serviceType:result.serviceType||"Delivery",scheduledFor:result.scheduledFor||null };
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
      body: JSON.stringify({ items: activeCheckoutItems, voucher: voucherCode.value.trim(), specialDiscount: specialDiscountApplied, serviceType: orderType })
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
  const checkbox = itemNode.querySelector("[data-action='select']");
  checkbox.setAttribute("aria-label", `Select ${item.name}`);
  if (KopiStore.getSelected().includes(item.cartId)) checkbox.setAttribute("checked", "");
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
  // One cart line accepts 1 to 100 (the backend limit). Tick it and use Remove Selected to delete it.
  if (item.quantity <= 1) decrease.setAttribute("disabled", "");
  if (item.quantity >= MAX_LINE_QUANTITY || (KopiStore.room && item.quantity >= KopiStore.room(item.productId, item.cartId).left)) {
    increase.setAttribute("disabled", "");
    increase.title = KopiStore.limitMessage ? KopiStore.limitMessage(KopiStore.room(item.productId, item.cartId).kind) : "";
  }

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
  document.getElementById("receiptTimeLabel").textContent = placedOrder.serviceType === "Pickup" ? "PICKUP TIME:" : "RIDER PICKUP:";
  document.getElementById("receiptTime").textContent = formatSchedule(placedOrder.scheduledFor);
  receiptDate.textContent = date;
  document.getElementById("receiptPayment").textContent = placedOrder.payment === "Cash"
    ? (placedOrder.serviceType === "Pickup" ? "Cash (pay at store)" : "Cash on delivery") : placedOrder.payment;
  document.getElementById("receiptReferenceRow").hidden = placedOrder.payment !== "GCash";
  document.getElementById("receiptReference").textContent = placedOrder.paymentReference;
  document.getElementById("receiptPaymentStatus").textContent = placedOrder.payment === "GCash"
    ? (["Verified", "Paid"].includes(placedOrder.paymentStatus) ? "Paid — GCash payment verified by staff." : "Payment awaiting staff verification. This receipt confirms your order, not your payment.")
    : placedOrder.paymentStatus === "Paid" ? "Paid — Cash payment received."
      : placedOrder.serviceType === "Pickup" ? "Pickup order — pay at the store when you pick it up. We will tell you when it is ready."
      : "Cash payment due on delivery.";
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
    document.getElementById("receiptSpecialHolder").textContent = `${special.type} ID ${special.idNumber} · ${special.name}. Our staff will verify your ID photo before preparing the order. Please show the same ID ${placedOrder.serviceType === "Pickup" ? "at the counter" : "to the rider"}.`;
  }
  document.getElementById("receiptDeliveryRow").hidden = !activeTotals.delivery;
  document.getElementById("receiptDeliveryFee").textContent = `₱ ${formatMoney(activeTotals.delivery)}`;
  receiptTotal.textContent = `₱ ${formatMoney(activeTotals.total)}`;
  receiptModal.hidden = false;
}

// What the customer sees for an order with no chosen time.
function priorityName(serviceType) {
  return serviceType === "Pickup" ? "Priority Pickup" : "Priority Delivery";
}

// Receipt wording for the pickup or rider handover time.
function formatSchedule(iso) {
  if (!iso) return priorityName(placedOrder?.serviceType);
  return new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function bindItemActions(root) {
  root.querySelectorAll("[data-action='select']").forEach(checkbox => {
    checkbox.addEventListener("change", () => {
      const cartId = checkbox.closest("[data-cart-id]").dataset.cartId;
      const selected = new Set(KopiStore.getSelected());
      if (checkbox.checked) selected.add(cartId);
      else selected.delete(cartId);
      KopiStore.setSelected([...selected]);
      syncCartSelection();
    });
  });

  root.querySelectorAll("[data-action='increase'], [data-action='decrease']").forEach(button => {
    button.addEventListener("click", async () => {
      const cartId = button.closest("[data-cart-id]").dataset.cartId;
      const item = KopiStore.getCart().find(entry => entry.cartId === cartId);
      if (!item) return;
      const step = button.dataset.action === "increase" ? 1 : -1;
      const quantity = Math.min(MAX_LINE_QUANTITY, Math.max(1, item.quantity + step));
      if (quantity === item.quantity) return;
      const room = KopiStore.room(item.productId, cartId);
      if (step > 0 && quantity > room.left) {
        KopiNotice.toast(KopiStore.limitMessage(room.kind), "warning");
        return;
      }
      // Adding one more stops when the shop does not have enough ingredients.
      if (step > 0 && KopiApi.getSession()) {
        button.disabled = true;
        try {
          const others = KopiStore.getCart().filter(entry => entry.cartId !== cartId)
            .map(entry => ({productId: entry.productId, quantity: entry.quantity, options: entry.options || {}}));
          const result = await KopiApi.request("/orders/stock-check", {method: "POST", body: JSON.stringify({
            item: {productId: item.productId, quantity, options: item.options || {}}, others})});
          if (!result.ok) {
            KopiNotice.toast(result.message, "warning");
            button.disabled = false;
            return;
          }
        } catch (error) {
          if (error.status === 409) {
            KopiNotice.toast(error.message, "warning");
            button.disabled = false;
            return;
          }
          // Network trouble: the checkout page checks the stock again.
        }
        button.disabled = false;
      }
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
      // Edit opens on this page, so closing it keeps the customer in the cart.
      const cartId = button.closest("[data-cart-id]").dataset.cartId;
      KopiCartEdit.open(cartId, renderCart);
    });
  });

}

function formatMoney(value) {
  return Number(value).toFixed(2);
}

function formatWhole(value) {
  return Math.round(Number(value)).toLocaleString("en-US");
}

// Edit a cart item right on the Cart page. Closing it keeps the customer in the cart.
const KopiCartEdit = (() => {
  let dialog = null;
  let state = null;
  let onSaved = () => {};
  // Sizes, choices and add-ons that cannot be made right now, by product.
  let soldChoices = {};

  const text = value => String(value ?? "").replace(/[&<>'"]/g, character => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"}[character]));
  const isSoldOut = (label, value) => (soldChoices[state.product.id]?.[label] || []).includes(value);

  function build() {
    dialog = document.createElement("dialog");
    dialog.className = "cart-edit";
    dialog.setAttribute("aria-labelledby", "cartEditTitle");
    dialog.innerHTML = `
      <form class="cart-edit-card" method="dialog" novalidate>
        <button class="cart-edit-close close-panel" type="button" data-edit-close aria-label="Close and go back to cart"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
        <div class="cart-edit-head">
          <img class="cart-edit-img" alt="">
          <div>
            <p class="cart-edit-kicker">Edit item</p>
            <h2 id="cartEditTitle"></h2>
            <p class="cart-edit-desc"></p>
          </div>
        </div>
        <div class="cart-edit-options"></div>
        <footer class="cart-edit-foot">
          <div class="cart-edit-price"><span data-edit-price-label>Price</span><strong data-edit-price>₱ 0</strong></div>
          <div class="cart-edit-actions">
            <button class="cart-edit-cancel" type="button" data-edit-close>Cancel</button>
            <button class="dark-btn cart-edit-save" type="submit">Save</button>
          </div>
        </footer>
      </form>`;
    document.body.append(dialog);
    dialog.querySelectorAll("[data-edit-close]").forEach(button => button.addEventListener("click", close));
    dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
    dialog.querySelector("form").addEventListener("submit", event => { event.preventDefault(); save(); });
    dialog.querySelector(".cart-edit-options").addEventListener("click", event => {
      const pill = event.target.closest(".cart-edit-pill:not([disabled])");
      if (!pill) return;
      const { key, value } = pill.dataset;
      // Add-ons can be turned off by tapping them again.
      state.choices[key] = key === "addons" && state.choices[key] === value ? null : value;
      render();
    });
  }

  function open(cartId, savedCallback) {
    const cartItem = KopiStore.getCart().find(item => item.cartId === cartId);
    const product = cartItem && KopiStore.findProduct(cartItem.productId);
    if (!product) { KopiNotice.toast("This item is no longer on the menu.", "warning"); return; }
    if (!dialog) build();
    onSaved = savedCallback || (() => {});
    state = { product, cartId, quantity: cartItem.quantity, choices: {} };
    product.options.forEach(option => {
      const saved = cartItem.options?.[option.label] ?? cartItem.options?.[option.key];
      state.choices[option.key] = option.key === "addons"
        ? saved ?? null
        : saved ?? option.defaultValue ?? (option.values.length === 1 ? option.values[0] : null);
    });
    const image = dialog.querySelector(".cart-edit-img");
    image.src = product.image;
    image.alt = product.name;
    dialog.querySelector("#cartEditTitle").textContent = product.name;
    dialog.querySelector(".cart-edit-desc").textContent = product.description || "";
    render();
    dialog.showModal();
    refreshAvailability();
  }

  function close() {
    dialog?.close();
  }

  // Check which choices ran out so they show as sold out.
  async function refreshAvailability() {
    try {
      const { products } = await KopiApi.request("/menu/availability");
      soldChoices = Object.fromEntries(products.map(item => [item.productId, item.unavailable || {}]));
      if (dialog.open) render();
    } catch {}
  }

  function render() {
    const { product } = state;
    dialog.querySelector(".cart-edit-options").innerHTML = product.options.map(option => `
      <fieldset class="cart-edit-group"><legend>${text(option.label)}</legend><div class="cart-edit-pills">
        ${option.values.map(value => {
          const chosen = state.choices[option.key] === value;
          // A choice already in the cart stays selectable even if it ran out after it was added.
          if (isSoldOut(option.label, value) && !chosen) return `<button class="cart-edit-pill sold-out" type="button" disabled>${text(value)} · Sold out</button>`;
          const price = option.priceKey && product.prices[value] != null ? ` · ₱${product.prices[value]}`
            : option.addOnPrice ? ` · +₱${option.addOnPrice}` : "";
          return `<button class="cart-edit-pill${chosen ? " active" : ""}" type="button" data-key="${text(option.key)}" data-value="${text(value)}" aria-pressed="${chosen}">${text(value)}${price}</button>`;
        }).join("")}
      </div></fieldset>`).join("");
    // Quantity is changed in My Cart, so the price here covers the quantity already there.
    dialog.querySelector("[data-edit-price-label]").textContent = state.quantity > 1 ? `Price (${state.quantity} pcs)` : "Price";
    dialog.querySelector("[data-edit-price]").textContent = `₱ ${(unitPrice() * state.quantity).toLocaleString("en-US")}`;
  }

  function unitPrice() {
    const { product, choices } = state;
    const sizeOption = product.options.find(option => option.priceKey);
    const price = sizeOption ? product.prices[choices[sizeOption.key]] : null;
    const addOns = product.options.reduce((total, option) => total + (option.addOnPrice && choices[option.key] ? option.addOnPrice : 0), 0);
    return (price ?? Object.values(product.prices)[0]) + addOns;
  }

  function save() {
    const { product, choices } = state;
    const missing = product.options.find(option => option.priceKey && !choices[option.key]);
    if (missing) { KopiNotice.toast(`Please select ${missing.label.toLowerCase()} first.`); return; }
    const options = {};
    product.options.forEach(option => { if (choices[option.key] != null) options[option.label] = choices[option.key]; });
    KopiStore.updateCartItem(state.cartId, { options, price: unitPrice() });
    close();
    KopiNotice.toast(`${product.name} updated.`, "success");
    onSaved();
  }

  return { open, close };
})();
