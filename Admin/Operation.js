const rowsEl = document.getElementById("operationsRows");
const emptyEl = document.getElementById("operationsEmpty");
const panelEl = document.getElementById("orderStatusPanel");
const selectedOrderEl = document.getElementById("selectedOrderSummary");
const selectedPaymentActions = document.getElementById("selectedPaymentActions");
const orderAddressEl = document.getElementById("orderAddress");
const orderPhoneEl = document.getElementById("orderPhone");

const state = {orders: [], type: "All", status: "All", query: "", selectedId: null};
let paymentUpdating = false;
const peso = value => `₱${Number(value || 0).toFixed(2)}`;
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
}[character]));
const formatOrderTime = value => new Date(value).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});

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
  return order.payment === "GCash" && order.paymentStatus !== "Verified" && order.status !== "Canceled"
    ? "Verify GCash" : "See Details";
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
      <td><span class="status-badge ${order.status.toLowerCase().replaceAll(" ", "-")}">${escapeHtml(order.status)}</span></td>
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
    <p><span>Payment method</span><strong>${escapeHtml(order.payment)}</strong></p>
    ${order.payment === "GCash" ? `<p><span>Reference number</span><strong>${escapeHtml(order.paymentReference || "Not provided")}</strong></p><p><span>Payment status</span><strong>${escapeHtml(order.paymentStatus)}</strong></p>` : ""}
    <p><span>Order Time:</span><strong>${formatOrderTime(order.createdAt)}</strong></p>`;
  orderAddressEl.textContent = order.address?.trim() || "Not provided";
  orderPhoneEl.textContent = order.phone?.trim() || "Not provided";
  selectedPaymentActions.replaceChildren();
  if (order.payment === "GCash" && order.paymentStatus !== "Verified" && ["New", "Preparing"].includes(order.status)) {
    const verifyButton = document.createElement("button");
    verifyButton.type = "button";
    verifyButton.className = "verify-payment-btn";
    verifyButton.textContent = "Confirm GCash received";
    const rejectButton = document.createElement("button");
    rejectButton.type = "button";
    rejectButton.className = "reject-payment-btn";
    rejectButton.textContent = "GCash not received — Cancel order";
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
      if (!window.confirm(`Check GCash first. Have you received ${peso(order.total)} with reference ${order.paymentReference}? Confirm only if both match.`)) return;
      await reviewPayment("verify-payment", {confirmedReceived: true});
    });
    rejectButton.addEventListener("click", async () => {
      if (!window.confirm(`Confirm that the GCash payment of ${peso(order.total)} for ${order.orderNumber} was not received. This will cancel the order and notify the customer. Continue?`)) return;
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
  if (["New", "Preparing"].includes(order.status) && !awaitingGcashReview) {
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
  renderRows();
  if (!panelEl.open) panelEl.showModal();
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
