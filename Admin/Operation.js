const rowsEl = document.getElementById("operationsRows");
const emptyEl = document.getElementById("operationsEmpty");
const panelEl = document.getElementById("orderStatusPanel");
const selectedOrderEl = document.getElementById("selectedOrderSummary");
const selectedPaymentActions = document.getElementById("selectedPaymentActions");
const currentStatusEl = document.getElementById("currentStatus");
const orderAddressEl = document.getElementById("orderAddress");
const orderPhoneEl = document.getElementById("orderPhone");
const statusTrackEl = document.getElementById("statusTrack");
const actionButtonsEl = document.getElementById("statusActionButtons");
const sendDeliveryButton = document.getElementById("sendDeliveryDetails");
const deliverySaved = document.getElementById("deliverySaved");
const deliveryDialog = document.getElementById("deliveryDialog");
const deliveryForm = document.getElementById("deliveryForm");
const deliveryFields = document.getElementById("deliveryFields");
const riderFee = document.getElementById("riderFee");
const riderTrackingLink = document.getElementById("riderTrackingLink");
const deliveryFormStatus = document.getElementById("deliveryFormStatus");
const closeDeliveryButton = document.getElementById("closeDeliveryDialog");
let deliveryDraft = null;
let deliverySaving = false;

const state = {
  orders: [],
  type: "All",
  status: "All",
  query: "",
  selectedId: null
};

function peso(value) {
  return `₱${Number(value || 0).toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[character]));
}

function formatOrderTime(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function filteredOrders() {
  return state.orders.filter(order => {
    const typeMatches = state.type === "All" || order.orderType === state.type;
    const statusMatches = state.status === "All" || order.status === state.status;
    const searchText = `${order.orderNumber} ${order.customer}`.toLowerCase();

    return typeMatches &&
      statusMatches &&
      (!state.query || searchText.includes(state.query));
  });
}

function updateCounts() {
  const typeOrders = state.orders.filter(order =>
    state.type === "All" || order.orderType === state.type
  );

  document.getElementById("allCount").textContent = typeOrders.length;
  document.getElementById("preparingCount").textContent =
    typeOrders.filter(order => order.status === "Preparing").length;
  document.getElementById("completedCount").textContent =
    typeOrders.filter(order => order.status === "Completed").length;
}

function renderRows() {
  const orders = filteredOrders();

  rowsEl.innerHTML = orders.map((order, index) => `
    <tr class="${order.id === state.selectedId ? "selected" : ""}">
      <td>${index + 1}</td>
      <td><strong>${escapeHtml(order.orderNumber)}</strong></td>
      <td>
        <span class="type-badge ${order.orderType === "In-store" ? "in-store" : "online"}">
          <i class="bi ${order.orderType === "In-store" ? "bi-shop" : "bi-globe2"}"></i>
          ${escapeHtml(order.orderType)}
        </span>
      </td>
      <td>${escapeHtml(order.customer)}</td>
      <td>${order.itemCount} ${order.itemCount === 1 ? "item" : "items"}</td>
      <td><strong>${peso(order.total)}</strong></td>
      <td>${escapeHtml(order.payment)}${order.payment === "GCash" ? `<small class="payment-review-status">${escapeHtml(order.paymentStatus)}</small>` : ""}</td>
      <td>
        <span class="status-badge ${order.status.toLowerCase().replaceAll(" ", "-")}">
          ${escapeHtml(order.status)}
        </span>
      </td>
      <td>${formatOrderTime(order.createdAt)}</td>
      <td>
        ${["Completed", "Canceled"].includes(order.status)
          ? '<span class="row-complete">—</span>'
          : `<button class="row-update" type="button" data-id="${escapeHtml(order.id)}">Update</button>`}
      </td>
    </tr>
  `).join("");

  emptyEl.hidden = orders.length !== 0;
  emptyEl.textContent = "No operations match these filters.";
  // This is a normal empty state, not an alert or notice banner.
  emptyEl.classList.remove("kopi-notice");
  delete emptyEl.dataset.noticeType;
  delete emptyEl.dataset.noticeMessage;
  emptyEl.removeAttribute("aria-live");
  emptyEl.removeAttribute("aria-atomic");

  rowsEl.querySelectorAll(".row-update").forEach(button => {
    button.addEventListener("click", () => {
      selectOrder(Number(button.dataset.id));
    });
  });

  updateCounts();
}

async function refreshOrders() {
  try {
    const data = await KopiApi.request("/admin/orders");
    state.orders = data.orders;
    renderRows();
    if (state.selectedId !== null) {
      if (state.orders.some(order => order.id === state.selectedId)) selectOrder(state.selectedId);
      else { state.selectedId = null; panelEl.hidden = true; }
    }
  } catch (error) {
    rowsEl.innerHTML = "";
    emptyEl.hidden = false;
    KopiNotice.set(emptyEl,error.message,"error");
  }
}

function selectOrder(id) {
  state.selectedId = id;

  const order = state.orders.find(entry => entry.id === id);
  if (!order) return;
  selectedPaymentActions.replaceChildren();

  selectedOrderEl.innerHTML = `
    <h2>Order ${escapeHtml(order.orderNumber)}</h2>
    <p>Customer: ${escapeHtml(order.customer)}</p>
    <p>Items: ${order.itemCount}</p>
    <p>Total: ${peso(order.total)}</p>
    <p>Payment: ${escapeHtml(order.payment)}</p>
    ${order.refundStatus === "Needs staff review" ? "<p>GCash refund needs staff review; no refund was sent automatically.</p>" : ""}
    ${order.payment === "GCash" ? `
      <p>Reference: <strong>${escapeHtml(order.paymentReference || "Not provided")}</strong></p>
      <p>Payment status: ${escapeHtml(order.paymentStatus)}</p>
    ` : ""}
    <p>Order Time: ${formatOrderTime(order.createdAt)}</p>
  `;

  currentStatusEl.className =
    `current-status ${order.status.toLowerCase().replaceAll(" ", "-")}`;
  currentStatusEl.textContent = order.status;
  orderAddressEl.textContent = order.address?.trim() || "Not provided";
  orderPhoneEl.textContent = order.phone?.trim() || "Not provided";
  const canSendDelivery = order.orderType === "Online" &&
    (order.status === "Preparing" || (order.deliveryRevision > 0 && ["Out for Delivery", "Arrived"].includes(order.status)));
  sendDeliveryButton.hidden = !canSendDelivery;
  sendDeliveryButton.disabled = order.payment === "GCash" && order.paymentStatus !== "Verified";
  sendDeliveryButton.textContent = order.deliveryRevision > 0 ? "Update Delivery Details" : "Send Delivery Details";
  deliverySaved.hidden = !order.deliveryRevision;
  deliverySaved.textContent = order.deliveryRevision
    ? `Lalamove fee: ${peso(order.riderFee)} (paid to rider). ${order.deliveryAcknowledgedAt ? "Customer acknowledged." : "Awaiting customer acknowledgement."}` : "";

  const flow = order.orderType === "In-store"
    ? ["Preparing", "Completed"]
    : ["New", "Preparing", "Out for Delivery", "Arrived", "Completed"];

  const currentIndex = flow.indexOf(order.status);

  statusTrackEl.innerHTML = flow.map((status, index) => `
    <span class="status-step ${
      order.status === status ? "active" : currentIndex > index ? "done" : ""
    }">
      <i class="bi ${status === "Completed" ? "bi-check-lg" : "bi-box-seam"}"></i>
      ${status}
    </span>
  `).join("");

  const actions = order.status === "Completed" || order.status === "Canceled"
    ? []
    : [
        currentIndex >= 0 ? flow[currentIndex + 1] : null,
        ["New", "Preparing"].includes(order.status) ? "Canceled" : null
      ].filter(Boolean);

  actionButtonsEl.innerHTML = actions.length
    ? actions.map(status => `
        <button
          class="status-action ${status.toLowerCase().replaceAll(" ", "-")}"
          type="button"
          data-status="${status}">
          Mark as ${status}
        </button>
      `).join("")
    : '<span class="row-complete">No further action needed.</span>';

  actionButtonsEl.querySelectorAll("button").forEach(button => {
    if (order.orderType === "Online" && order.payment === "GCash" &&
        order.paymentStatus !== "Verified" && button.dataset.status !== "Canceled") {
      button.disabled = true;
      button.title = "Verify the GCash payment first.";
    }
    button.addEventListener("click", () => {
      updateStatus(order.id, button.dataset.status);
    });
  });

  if (order.payment === "GCash" && order.paymentReference &&
      order.paymentStatus !== "Verified" && order.status !== "Canceled") {
    const verifyButton = document.createElement("button");
    verifyButton.type = "button";
    verifyButton.className = "verify-payment-btn";
    verifyButton.textContent = "Confirm GCash received";
    verifyButton.addEventListener("click", async () => {
      const confirmed = window.confirm(
        `Check your GCash account first. Have you received ${peso(order.total)} with reference ${order.paymentReference}? Only confirm if BOTH match. A customer-entered reference is not proof of payment.`
      );
      if (!confirmed) return;
      verifyButton.disabled = true;
      try {
        await KopiApi.request(`/admin/orders/${order.id}/verify-payment`, {
          method: "PATCH",
          body: JSON.stringify({ confirmedReceived: true })
        });
        await refreshOrders();
        selectOrder(order.id);
      } catch (error) {
        KopiNotice.toast(error.message, "error");
        verifyButton.disabled = false;
      }
    });
    selectedPaymentActions.appendChild(verifyButton);
  }

  panelEl.hidden = false;
  renderRows();
}

async function updateStatus(id, status) {
  if (status === "Canceled" && !window.confirm("Cancel this order? Stock returns only if preparation has not started. Any GCash refund must be handled separately.")) return;
  try {
    await KopiApi.request(`/admin/orders/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });

    await refreshOrders();
    selectOrder(id);
  } catch (error) {
    KopiNotice.toast(error.message, "error");
  }
}

document.querySelectorAll(".operation-tab").forEach(button => {
  button.addEventListener("click", () => {
    state.type = button.dataset.type;
    state.status = "All";
    state.selectedId = null;
    panelEl.hidden = true;

    document.querySelectorAll(".operation-tab").forEach(tab => {
      tab.classList.toggle("active", tab === button);
    });

    document.querySelectorAll(".status-filter-btn").forEach(tab => {
      tab.classList.toggle("active", tab.dataset.status === "All");
    });

    renderRows();
  });
});

document.querySelectorAll(".status-filter-btn").forEach(button => {
  button.addEventListener("click", () => {
    state.status = button.dataset.status;

    document.querySelectorAll(".status-filter-btn").forEach(tab => {
      tab.classList.toggle("active", tab === button);
    });

    renderRows();
  });
});

document.getElementById("orderSearch").addEventListener("input", event => {
  state.query = event.target.value.trim().toLowerCase();
  renderRows();
});

document.getElementById("closePanel").addEventListener("click", () => {
  panelEl.hidden = true;
  state.selectedId = null;
  renderRows();
});

window.addEventListener("focus", refreshOrders);

function previewDelivery() {
  const fee = riderFee.value.trim() === "" ? NaN : Number(riderFee.value);
  document.getElementById("deliveryMessagePreview").textContent = KopiDeliveryInfo.message(fee, riderTrackingLink.value.trim());
}
riderFee.addEventListener("input", previewDelivery);
riderTrackingLink.addEventListener("input", () => { riderTrackingLink.setCustomValidity(""); previewDelivery(); });
sendDeliveryButton.addEventListener("click", () => {
  const order = state.orders.find(entry => entry.id === state.selectedId);
  if (!order || deliverySaving) return;
  deliveryDraft = {id: order.id, revision: order.deliveryRevision || 0};
  deliveryForm.reset();
  riderTrackingLink.setCustomValidity("");
  riderFee.value = order.riderFee ?? "";
  riderTrackingLink.value = order.trackingUrl || "";
  document.getElementById("deliveryOrderLabel").textContent = `Order ${order.orderNumber} · ${order.customer}`;
  deliveryFormStatus.textContent = "";
  previewDelivery();
  deliveryDialog.showModal();
  riderFee.focus();
});
closeDeliveryButton.addEventListener("click", () => { if (!deliverySaving) deliveryDialog.close(); });
deliveryDialog.addEventListener("cancel", event => { if (deliverySaving) event.preventDefault(); });
deliveryForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (deliverySaving || !deliveryDraft) return;
  const link = KopiDeliveryInfo.trackingUrl(riderTrackingLink.value);
  riderTrackingLink.setCustomValidity(link ? "" : "Paste a valid HTTPS Lalamove live tracking/share link.");
  if (!deliveryForm.reportValidity()) return;
  const draft = {...deliveryDraft};
  deliverySaving = true;
  deliveryFields.disabled = true;
  closeDeliveryButton.disabled = true;
  KopiNotice.set(deliveryFormStatus, "Sending delivery details…", "loading");
  try {
    await KopiApi.request(`/admin/orders/${draft.id}/delivery`, {
      method: "PUT",
      body: JSON.stringify({fee: Number(riderFee.value), trackingUrl: link, revision: draft.revision})
    });
    deliveryDialog.close();
    KopiNotice.toast("Delivery details saved and sent to the customer's website notifications.", "success");
    await refreshOrders();
  } catch (error) {
    KopiNotice.set(deliveryFormStatus, error.message, "error");
    if (error.status === 409) await refreshOrders();
  } finally {
    deliverySaving = false;
    deliveryFields.disabled = false;
    closeDeliveryButton.disabled = false;
  }
});

refreshOrders();
