const rowsEl = document.getElementById("operationsRows");
const emptyEl = document.getElementById("operationsEmpty");
const panelEl = document.getElementById("orderStatusPanel");
const selectedOrderEl = document.getElementById("selectedOrderSummary");
const selectedPaymentActions = document.getElementById("selectedPaymentActions");
const selectedDiscountActions = document.getElementById("selectedDiscountActions");
const orderAddressEl = document.getElementById("orderAddress");
const orderPhoneEl = document.getElementById("orderPhone");

const state = {orders: [], type: "All", status: "All", query: "", selectedId: null};
// Shared review helpers (OrderReview.js); optional so this page still works without them.
const orderReview = typeof KopiOrderReview === "undefined" ? null : KopiOrderReview;
let paymentUpdating = false;
const peso = value => `₱${Number(value || 0).toFixed(2)}`;
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
}[character]));
// Database times are UTC ("YYYY-MM-DD HH:MM:SS"); show them in Philippine time.
const formatOrderTime = value => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : String(value).replace(" ", "T") + "Z")
  .toLocaleTimeString("en-PH", {hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila"});

function filteredOrders() {
  return state.orders.filter(order =>
    (state.type === "All" || order.orderType === state.type) &&
    (state.status === "All" || order.status === state.status) &&
    (!state.query || `${order.orderNumber} ${order.customer}`.toLowerCase().includes(state.query))
  );
}

function updateCounts() {
  const orders = state.orders.filter(order => state.type === "All" || order.orderType === state.type);
  document.getElementById("allCount").textContent = orders.length;
  document.getElementById("preparingCount").textContent = orders.filter(order => order.status === "Preparing").length;
  document.getElementById("completedCount").textContent = orders.filter(order => order.status === "Completed").length;
}

function paymentActionLabel(order) {
  if (order.status === "Canceled") return "See Details";
  // Senior Citizen / PWD orders waiting for their ID photo to be checked.
  if (order.specialDiscountType && order.specialDiscountStatus === "Pending verification") return "Verify Order";
  return order.payment === "GCash" && order.paymentStatus !== "Verified" ? "Verify GCash" : "See Details";
}

function renderRows() {
  const orders = filteredOrders();
  rowsEl.innerHTML = orders.map((order, index) => `
    <tr class="${order.id === state.selectedId ? "selected" : ""}">
      <td>${index + 1}</td><td><strong>${escapeHtml(order.orderNumber)}</strong></td>
      <td><span class="type-badge ${order.orderType === "In-store" ? "in-store" : "online"}"><i class="bi ${order.orderType === "In-store" ? "bi-shop" : "bi-globe2"}"></i>${escapeHtml(order.orderType)}</span></td>
      <td>${escapeHtml(order.customer)}</td><td>${order.itemCount} ${order.itemCount === 1 ? "item" : "items"}</td>
      <td><strong>${peso(order.total)}</strong></td>
      <td>${escapeHtml(order.payment)}${order.payment === "GCash" ? `<small class="payment-review-status">${escapeHtml(order.paymentStatus)}</small>` : ""}</td>
      <td><span class="status-badge ${order.status.toLowerCase().replaceAll(" ", "-")}">${escapeHtml(order.status)}</span>${order.status === "New" && order.riskFlags?.length ? `<small class="payment-review-status" title="${escapeHtml(order.riskFlags.map(flag => flag.label).join(", "))}">⚑ ${order.riskFlags.length} check${order.riskFlags.length === 1 ? "" : "s"}</small>` : ""}${order.paymentWait?.overdue ? `<small class="payment-review-status">⏳ GCash ${order.paymentWait.minutes} min</small>` : ""}</td>
      <td>${formatOrderTime(order.createdAt)}</td>
      <td><button class="row-update" type="button" data-id="${order.id}">${paymentActionLabel(order)}</button></td>
    </tr>`).join("");
  emptyEl.hidden = orders.length !== 0;
  emptyEl.textContent = "No operations match these filters.";
  emptyEl.classList.remove("kopi-notice");
  emptyEl.removeAttribute("aria-live");
  rowsEl.querySelectorAll(".row-update").forEach(button => button.addEventListener("click", () => selectOrder(Number(button.dataset.id))));
  updateCounts();
}

async function refreshOrders() {
  if (paymentUpdating) return;
  try {
    const data = await KopiApi.request("/admin/orders");
    if (paymentUpdating) return;
    state.orders = data.orders;
    renderRows();
    if (state.selectedId !== null) {
      if (state.orders.some(order => order.id === state.selectedId)) selectOrder(state.selectedId);
      else {panelEl.close();}
    }
  } catch (error) {
    rowsEl.innerHTML = "";
    emptyEl.hidden = false;
    KopiNotice.set(emptyEl, error.message, "error");
  }
}

function selectOrder(id) {
  state.selectedId = id;
  const order = state.orders.find(entry => entry.id === id);
  if (!order) return;
  selectedOrderEl.innerHTML = `<header class="order-detail-heading">
      <div><span class="order-detail-eyebrow">Order details</span><h2 id="orderDetailsTitle">Order ${escapeHtml(order.orderNumber)}</h2></div>
      <span class="type-badge ${order.orderType === "In-store" ? "in-store" : "online"}">${escapeHtml(order.orderType)}</span>
    </header>
    <p><span>Customer</span><strong>${escapeHtml(order.customer)}</strong></p>
    <p><span>Items</span><strong>${escapeHtml(order.itemCount)}</strong></p>
    <p class="order-detail-total"><span>Total amount</span><strong>${peso(order.total)}</strong></p>
    ${order.specialDiscountType ? `<p class="order-detail-special${order.specialDiscountStatus === "Not approved" ? " not-approved" : ""}"><span>${escapeHtml(order.specialDiscountType)} discount</span><strong>${order.specialDiscountStatus === "Not approved" ? `Not approved (${peso(order.discountRemoved)} removed)` : `− ${peso(Number(order.specialDiscount) + Number(order.vatExempt))}`}</strong></p>
    <p><span>Cardholder / ID</span><strong>${escapeHtml(order.specialDiscountName)} · ${escapeHtml(order.specialDiscountId)}</strong></p>` : ""}
    <p><span>Payment method</span><strong>${escapeHtml(order.payment)}</strong></p>
    ${order.payment === "GCash" ? `<p><span>Reference number</span><strong class="key-value">${escapeHtml(order.paymentReference || "Not provided")}</strong></p><p><span>Payment status</span><strong>${escapeHtml(order.paymentStatus)}</strong></p>` : ""}
    <p><span>Order Time:</span><strong>${formatOrderTime(order.createdAt)}</strong></p>
    ${orderReview ? orderReview.flagsHtml(order) + orderReview.waitHtml(order) : ""}`;
  orderAddressEl.textContent = order.address?.trim() || "Not provided";
  orderPhoneEl.textContent = order.phone?.trim() || "Not provided";
  selectedPaymentActions.replaceChildren();
  if (order.hasPaymentProof && orderReview) {
    const proofButton = document.createElement("button");
    proofButton.type = "button";
    proofButton.className = "review-link-btn";
    proofButton.innerHTML = `<i class="bi bi-image" aria-hidden="true"></i> View GCash screenshot`;
    proofButton.addEventListener("click", () => orderReview.showProof(`/admin/orders/${order.id}/payment-proof`, order.orderNumber));
    selectedPaymentActions.appendChild(proofButton);
  }
  if (order.payment === "GCash" && order.paymentStatus !== "Verified" && ["New", "Preparing"].includes(order.status)) {
    const verifyButton = document.createElement("button");
    verifyButton.type = "button";
    verifyButton.className = "verify-payment-btn";
    verifyButton.textContent = "Confirm GCash received";
    const rejectButton = document.createElement("button");
    rejectButton.type = "button";
    rejectButton.className = "reject-payment-btn";
    rejectButton.textContent = "Not received — Cancel order";
    async function reviewPayment(action, body) {
      if (paymentUpdating) return;
      paymentUpdating = true;
      verifyButton.disabled = rejectButton.disabled = true;
      try {
        const result = await KopiApi.request(`/admin/orders/${order.id}/${action}`, {method: "PATCH", body: JSON.stringify(body)});
        KopiNotice.toast(result.message, "success");
      } catch (error) {
        KopiNotice.toast(error.message, "error");
      } finally {
        paymentUpdating = false;
        verifyButton.disabled = rejectButton.disabled = false;
        await refreshOrders();
      }
    }
    verifyButton.addEventListener("click", async () => {
      const amount = peso(order.gcashAmount ?? order.total);
      const confirmed = orderReview
        ? await orderReview.confirmDialog(`Confirm GCash for ${order.orderNumber}?`,
          ["Check the shop's GCash account first. Have you received ", {key: amount}, " with reference number ", {key: order.paymentReference || "(none)"}, "? Confirm only if both match."], "Confirm GCash received")
        : window.confirm(`Check GCash first. Have you received ${amount} with reference ${order.paymentReference}? Confirm only if both match.`);
      if (!confirmed) return;
      await reviewPayment("verify-payment", {confirmedReceived: true});
    });
    rejectButton.addEventListener("click", async () => {
      if (!window.confirm(`Confirm that the GCash payment of ${peso(order.gcashAmount ?? order.total)} for ${order.orderNumber} was not received. This will cancel the order and notify the customer. Continue?`)) return;
      await reviewPayment("reject-payment", {confirmedNotReceived: true});
    });
    selectedPaymentActions.appendChild(verifyButton);
    selectedPaymentActions.appendChild(rejectButton);
  } else if (order.payment === "Cash") {
    const cashNote = document.createElement("span");
    cashNote.className = `type-badge cash-payment-note ${order.orderType === "In-store" ? "in-store" : "online"}`;
    cashNote.innerHTML = `<i class="bi bi-cash-coin" aria-hidden="true"></i>Cash payment is handled at the ${order.orderType === "In-store" ? "counter" : "rider"}.`;
    selectedPaymentActions.appendChild(cashNote);
  } else {
    selectedPaymentActions.textContent = order.cancellationReason || (order.status === "Canceled"
      ? "This order has been canceled."
      : order.paymentStatus === "Verified" ? "GCash payment verified." : `GCash payment: ${order.paymentStatus || "Pending verification"}.`);
  }
  // Customers can cancel online only while an order is New. After that, an
  // administrator cancels it here (for example, when the customer calls).
  const awaitingGcashReview = order.payment === "GCash" && order.paymentStatus !== "Verified";
  // A new online order that cannot be confirmed (fake address, unreachable
  // phone, duplicate) is rejected with a reason the customer can read.
  // Unpaid GCash orders keep only the payment review buttons; they cannot be
  // prepared until verified, and "GCash not received" cancels them.
  if (order.orderType === "Online" && order.status === "New" && !awaitingGcashReview && orderReview) {
    const rejectOrderButton = document.createElement("button");
    rejectOrderButton.type = "button";
    rejectOrderButton.className = "reject-payment-btn admin-cancel-order-btn";
    rejectOrderButton.textContent = "Reject order";
    rejectOrderButton.addEventListener("click", async () => {
      const answer = await orderReview.rejectDialog(order);
      if (!answer || paymentUpdating) return;
      paymentUpdating = true;
      rejectOrderButton.disabled = true;
      try {
        const result = await KopiApi.request(`/admin/orders/${order.id}/reject`, {method: "PATCH", body: JSON.stringify(answer)});
        KopiNotice.toast(result.message, "success");
      } catch (error) {
        KopiNotice.toast(error.message, "error");
      } finally {
        paymentUpdating = false;
        rejectOrderButton.disabled = false;
        await refreshOrders();
      }
    });
    selectedPaymentActions.appendChild(rejectOrderButton);
  } else if (["New", "Preparing"].includes(order.status) && !awaitingGcashReview) {
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "reject-payment-btn admin-cancel-order-btn";
    cancelButton.textContent = "Cancel order";
    cancelButton.addEventListener("click", async () => {
      const warning = order.status === "Preparing"
        ? "Preparation has started, so ingredients will stay deducted."
        : "Reserved ingredients will be returned to stock.";
      const refund = order.payment === "GCash" && order.paymentStatus === "Verified" ? " Any GCash refund must be sent separately." : "";
      if (!window.confirm(`Cancel ${order.orderNumber}? ${warning}${refund}`)) return;
      if (paymentUpdating) return;
      paymentUpdating = true;
      cancelButton.disabled = true;
      try {
        const result = await KopiApi.request(`/orders/${order.id}/cancel`, {method: "PATCH"});
        KopiNotice.toast(result.message, "success");
      } catch (error) {
        KopiNotice.toast(error.message, "error");
      } finally {
        paymentUpdating = false;
        cancelButton.disabled = false;
        await refreshOrders();
      }
    });
    selectedPaymentActions.appendChild(cancelButton);
  }
  renderDiscountBox(order);
  renderRows();
  if (!panelEl.open) panelEl.showModal();
}

// Senior Citizen / PWD box: online customers upload a photo of the ID, which
// is verified here like a GCash payment before the order can be prepared.
function renderDiscountBox(order) {
  if (!selectedDiscountActions) return;
  selectedDiscountActions.replaceChildren();
  selectedDiscountActions.hidden = !order.specialDiscountType;
  if (!order.specialDiscountType) return;
  const pending = order.specialDiscountStatus === "Pending verification" && order.status !== "Canceled";
  const info = document.createElement("div");
  info.innerHTML = `${orderReview ? orderReview.idStatusHtml(order) : ""}
    <p class="discount-id-line"><strong>${escapeHtml(order.specialDiscountName)}</strong> · ${escapeHtml(order.specialDiscountType)} ID ${escapeHtml(order.specialDiscountId)}
    <small>${order.orderType === "In-store" ? "The cashier checked the physical ID at the counter."
      : pending ? "Compare the ID photo with the name and ID number before preparing this order."
      : order.specialDiscountStatus === "Not approved" ? `Not approved: the ${peso(order.discountRemoved)} discount was removed and the order continues at the normal price of ${peso(order.total)}. The customer was notified.${order.balanceDue ? ` Collect ${peso(order.balanceDue)} in cash on delivery (GCash covered the discounted amount).` : ""}`
      : order.hasIdProof ? "ID photo verified." : "Checked before ID photos were required."}</small></p>`;
  selectedDiscountActions.appendChild(info);
  if (order.hasIdProof && orderReview) {
    const viewButton = document.createElement("button");
    viewButton.type = "button";
    viewButton.className = "review-link-btn";
    viewButton.innerHTML = `<i class="bi bi-person-vcard" aria-hidden="true"></i> View ID`;
    viewButton.addEventListener("click", () => orderReview.showProof(`/admin/orders/${order.id}/id-proof`, order.orderNumber, "id"));
    selectedDiscountActions.appendChild(viewButton);
  }
  if (!pending) return;
  const verifyButton = document.createElement("button");
  verifyButton.type = "button";
  verifyButton.className = "verify-payment-btn verify-id-btn";
  verifyButton.textContent = "Verify ID";
  const rejectButton = document.createElement("button");
  rejectButton.type = "button";
  rejectButton.className = "reject-payment-btn reject-id-btn";
  rejectButton.textContent = "Not approved — Remove discount";
  async function reviewId(action, body) {
    if (paymentUpdating) return;
    paymentUpdating = true;
    verifyButton.disabled = rejectButton.disabled = true;
    try {
      const result = await KopiApi.request(`/admin/orders/${order.id}/${action}`, {method: "PATCH", body: JSON.stringify(body)});
      KopiNotice.toast(result.message, "success");
    } catch (error) {
      KopiNotice.toast(error.message, "error");
    } finally {
      paymentUpdating = false;
      verifyButton.disabled = rejectButton.disabled = false;
      await refreshOrders();
    }
  }
  verifyButton.addEventListener("click", async () => {
    if (!window.confirm(`Did you open the ID photo and check that it is a valid ${order.specialDiscountType} ID for ${order.specialDiscountName} with number ${order.specialDiscountId}? Confirm only if they match.`)) return;
    await reviewId("verify-id", {confirmedValid: true});
  });
  rejectButton.addEventListener("click", async () => {
    const answer = orderReview ? await orderReview.notApproveDialog(order) : (window.confirm(`Remove the discount from ${order.orderNumber} and charge the normal price?`) ? {note: ""} : null);
    if (answer) await reviewId("not-approve-id", answer);
  });
  selectedDiscountActions.appendChild(verifyButton);
  selectedDiscountActions.appendChild(rejectButton);
}

document.querySelectorAll(".operation-tab").forEach(button => button.addEventListener("click", () => {
  state.type = button.dataset.type;
  state.status = "All";
  state.selectedId = null;
  panelEl.close();
  document.querySelectorAll(".operation-tab").forEach(tab => tab.classList.toggle("active", tab === button));
  document.querySelectorAll(".status-filter-btn").forEach(tab => tab.classList.toggle("active", tab.dataset.status === "All"));
  renderRows();
}));
document.querySelectorAll(".status-filter-btn").forEach(button => button.addEventListener("click", () => {
  state.status = button.dataset.status;
  document.querySelectorAll(".status-filter-btn").forEach(tab => tab.classList.toggle("active", tab === button));
  renderRows();
}));
document.getElementById("orderSearch").addEventListener("input", event => {state.query = event.target.value.trim().toLowerCase(); renderRows();});
document.getElementById("closePanel").addEventListener("click", () => panelEl.close());
panelEl.addEventListener("close", () => {
  const selectedId = state.selectedId;
  state.selectedId = null;
  renderRows();
  rowsEl.querySelector(`[data-id="${selectedId}"]`)?.focus();
});
panelEl.addEventListener("click", event => {
  if (event.target !== panelEl) return;
  const bounds = panelEl.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) panelEl.close();
});
window.addEventListener("focus", refreshOrders);
refreshOrders();
