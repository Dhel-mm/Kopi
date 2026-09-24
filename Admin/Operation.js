const rowsEl = document.getElementById("operationsRows");
const emptyEl = document.getElementById("operationsEmpty");
const panelEl = document.getElementById("orderStatusPanel");
const selectedOrderEl = document.getElementById("selectedOrder");
const currentStatusEl = document.getElementById("currentStatus");
const statusTrackEl = document.getElementById("statusTrack");
const actionButtonsEl = document.getElementById("statusActionButtons");

const state = {
  orders: [],
  type: "In-store",
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
    <tr class="${order.orderNumber === state.selectedId ? "selected" : ""}">
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
  } catch (error) {
    rowsEl.innerHTML = "";
    emptyEl.hidden = false;
    emptyEl.textContent = error.message;
  }
}

function selectOrder(id) {
  state.selectedId = id;

  const order = state.orders.find(entry => entry.id === id);
  if (!order) return;

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
        alert(error.message);
        verifyButton.disabled = false;
      }
    });
    selectedOrderEl.appendChild(verifyButton);
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
    alert(error.message);
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

document.getElementById("filterButton").addEventListener("click", () => {
  state.status = "All";
  renderRows();
});

document.getElementById("closePanel").addEventListener("click", () => {
  panelEl.hidden = true;
  state.selectedId = null;
  renderRows();
});

window.addEventListener("focus", refreshOrders);

refreshOrders();
