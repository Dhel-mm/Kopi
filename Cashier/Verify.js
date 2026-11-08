/* The cashier's verification desk: GCash payments, Senior Citizen / PWD IDs and
   the balance left when a discount was not approved. Staff cannot do any of these. */
(async () => {
  "use strict";
  const user = await KopiWorkplace.ready;
  if (!user) return;
  const {escape: esc, date, money} = KopiWorkplace;
  const queue = document.getElementById("verifyQueue");
  const message = document.getElementById("verifyMessage");
  const search = document.getElementById("verifySearch");
  const refresh = document.getElementById("refreshVerify");
  const api = id => `/workforce/verifications/${id}`;
  let rows = [], loading = false, updating = false, version = 0;
  const pending = new Set();

  const needsGcash = order => order.payment === "GCash" && order.paymentStatus === "Pending verification" && ["New", "Preparing"].includes(order.status);
  const needsId = order => order.specialDiscountType && order.specialDiscountStatus === "Pending verification";

  function card(order) {
    const busy = pending.has(order.id) ? "disabled" : "";
    const gcash = needsGcash(order) ? `<section class="prep-discount pending" aria-label="GCash payment">
        <div class="prep-discount-head"><strong><i class="bi bi-phone" aria-hidden="true"></i> GCash payment</strong><span class="id-status pending"><i class="bi bi-hourglass-split" aria-hidden="true"></i>Needs checking</span></div>
        <p>Reference <strong class="key-value">${esc(order.paymentReference || "not provided")}</strong> · <strong class="key-value">${money(order.gcashAmount ?? order.total)}</strong></p>
        <div class="review-actions">
          ${order.hasPaymentProof ? `<button type="button" class="review-link-btn" data-proof="${order.id}"><i class="bi bi-image" aria-hidden="true"></i> View receipt</button>` : ""}
          <button type="button" class="review-link-btn verify" data-verify="${order.id}" ${busy}><i class="bi bi-patch-check" aria-hidden="true"></i> GCash received</button>
          <button type="button" class="review-link-btn danger" data-not-received="${order.id}" ${busy}><i class="bi bi-x-octagon" aria-hidden="true"></i> Not received</button>
        </div>
      </section>` : "";
    const discount = needsId(order) ? `<section class="prep-discount pending" aria-label="Senior Citizen / PWD discount">
        <div class="prep-discount-head"><strong><i class="bi bi-person-vcard" aria-hidden="true"></i> ${esc(order.specialDiscountType)} discount</strong>${KopiOrderReview.idStatusHtml(order)}</div>
        <p>${esc(order.specialDiscountName)} · ID ${esc(order.specialDiscountId)} — compare the ID photo with these details.</p>
        <div class="review-actions">
          ${order.hasIdProof ? `<button type="button" class="review-link-btn" data-view-id="${order.id}"><i class="bi bi-person-vcard" aria-hidden="true"></i> View ID</button>` : ""}
          <button type="button" class="review-link-btn verify" data-verify-id="${order.id}" ${busy}><i class="bi bi-patch-check" aria-hidden="true"></i> ID is valid</button>
          <button type="button" class="review-link-btn danger" data-not-approved="${order.id}" ${busy}><i class="bi bi-x-octagon" aria-hidden="true"></i> Not approved</button>
        </div>
      </section>` : "";
    const balance = order.balanceDue > 0 ? `<section class="prep-discount not-approved" aria-label="Remaining balance">
        <div class="prep-discount-head"><strong><i class="bi bi-cash-coin" aria-hidden="true"></i> Remaining balance</strong></div>
        <p>The ${esc(order.specialDiscountType)} discount was not approved. The customer still owes <strong class="key-value">${money(order.balanceDue)}</strong>.</p>
        <div class="review-actions"><button type="button" class="review-link-btn verify" data-balance="${order.id}" ${busy}><i class="bi bi-phone" aria-hidden="true"></i> Paid by GCash</button></div>
      </section>` : "";
    return `<article class="prep-card"><header><div><h2>${esc(order.orderNumber)}</h2><span class="workspace-badge neutral">${esc(order.serviceType || "Online")}</span></div><span class="workspace-badge">${esc(order.status)}</span></header>
      <p class="prep-meta">${esc(order.customer)}<br>${esc(date(order.createdAt))}<span class="prep-meta-contact"><strong>Phone No.:</strong> <b class="prep-meta-value">${esc(order.phone || "Not provided")}</b></span><span class="prep-meta-contact"><strong>Total:</strong> <b class="prep-meta-value">${money(order.total)}</b></span></p>
      ${KopiOrderReview.flagsHtml(order)}${needsGcash(order) ? KopiOrderReview.waitHtml(order) : ""}
      ${gcash}${discount}${balance}
      <ul>${order.items.map(item => `<li><strong>${item.quantity} × ${esc(item.name)}</strong></li>`).join("")}</ul></article>`;
  }

  function render() {
    const term = search.value.trim().toLowerCase();
    document.getElementById("gcashCount").textContent = rows.filter(needsGcash).length;
    document.getElementById("idCount").textContent = rows.filter(needsId).length;
    document.getElementById("balanceCount").textContent = rows.filter(order => order.balanceDue > 0).length;
    const found = rows.filter(order => `${order.orderNumber} ${order.customer} ${order.paymentReference || ""}`.toLowerCase().includes(term));
    queue.innerHTML = found.map(card).join("");
    document.getElementById("verifyEmpty").hidden = found.length > 0;
  }

  async function load(force = false) {
    if ((loading || updating || document.querySelector("dialog[open]")) && !force) return;
    const current = ++version;
    loading = true;
    refresh.disabled = true;
    try {
      const data = await KopiApi.request("/workforce/verifications");
      if (current !== version) return;
      rows = data.orders;
      render();
      KopiNotice.set(message, "Updated just now.", "success");
    } catch (error) {
      if (current === version) KopiNotice.set(message, error.message + " Use Refresh to try again.", "error");
      if (error.status === 401) window.location.replace("../login.html");
    } finally {
      if (current === version) { loading = false; refresh.disabled = false; }
    }
  }

  async function act(order, action, body) {
    updating = true;
    version++;
    pending.add(order.id);
    render();
    try {
      const result = await KopiApi.request(`${api(order.id)}/${action}`, {method: "PATCH", body: JSON.stringify(body)});
      KopiNotice.toast(`${order.orderNumber} — ${result.message}`, "success");
    } catch (error) {
      KopiNotice.toast(error.message, "error");
    } finally {
      updating = false;
      pending.delete(order.id);
      await load(true);
    }
  }

  queue.addEventListener("click", async event => {
    const button = event.target.closest("button");
    if (!button || button.disabled || updating) return;
    const key = ["proof", "viewId", "verify", "notReceived", "verifyId", "notApproved", "balance"].find(name => button.dataset[name]);
    if (!key) return;
    const order = rows.find(row => row.id === Number(button.dataset[key]));
    if (!order) return;
    if (key === "proof") return KopiOrderReview.showProof(`${api(order.id)}/payment-proof`, order.orderNumber);
    if (key === "viewId") return KopiOrderReview.showProof(`${api(order.id)}/id-proof`, order.orderNumber, "id");
    if (key === "verify") {
      const amount = money(order.gcashAmount ?? order.total);
      if (await KopiOrderReview.confirmDialog(`Confirm GCash for ${order.orderNumber}?`,
        ["Check the shop's GCash account first. Have you received ", {key: amount}, " with reference number ", {key: order.paymentReference || "(none)"}, "? Confirm only if both match."], "Confirm GCash received")) {
        await act(order, "verify-payment", {confirmedReceived: true});
      }
    } else if (key === "notReceived") {
      if (await KopiNotice.confirm(`The GCash payment of ${money(order.gcashAmount ?? order.total)} for ${order.orderNumber} was not received. This will cancel the order and notify the customer.`, {title: "Payment not received?", confirmText: "Cancel order", cancelText: "Go back", danger: true})) {
        await act(order, "reject-payment", {confirmedNotReceived: true});
      }
    } else if (key === "verifyId") {
      if (await KopiNotice.confirm(`Did you open the ID photo and check that it is a valid ${order.specialDiscountType} ID for ${order.specialDiscountName} with number ${order.specialDiscountId}? Confirm only if they match.`, {title: "Verify ID?", confirmText: "Verify ID"})) {
        await act(order, "verify-id", {confirmedValid: true});
      }
    } else if (key === "notApproved") {
      const answer = await KopiOrderReview.notApproveDialog(order);
      if (answer) await act(order, "not-approve-id", answer);
    } else {
      const answer = await KopiOrderReview.balanceDialog(order);
      if (answer) await act(order, "balance-gcash", answer);
    }
  });
  search.addEventListener("input", render);
  refresh.addEventListener("click", () => load());
  setInterval(() => { if (document.visibilityState === "visible") load(); }, 15000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });
  load();
})();
