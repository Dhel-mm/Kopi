/* The notification button beside the cart: shows order updates right away,
   without waiting for the customer to open My Orders. What has been seen is
   remembered per account in this browser. */
(() => {
  const button = document.getElementById("orderBell");
  const count = document.getElementById("orderBellCount");
  if (!button || typeof KopiApi === "undefined") return;

  const customer = () => {
    const session = KopiApi.getSession();
    return session?.user?.role === "Customer" && session.token ? session : null;
  };
  if (!customer()) return;
  button.hidden = false;

  const POLL_MS = 15000;
  const seenKey = () => `kopiBellSeen:user${customer()?.user?.id}`;
  let orders = [];
  let known = null;
  let panel = null;

  function readSeen() {
    try { return JSON.parse(localStorage.getItem(seenKey())) || null; } catch { return null; }
  }
  function writeSeen(seen) {
    try { localStorage.setItem(seenKey(), JSON.stringify(seen)); } catch {}
  }

  // Anything the customer would want to hear about changes this signature.
  const signature = order => [order.status, order.paymentStatus, order.specialDiscountStatus, order.deliveryRevision].join("|");

  function describe(order) {
    const pickup = order.serviceType === "Pickup";
    if (order.status === "Canceled") return {icon: "bi-x-circle-fill", tone: "bad", title: "Order canceled", text: order.cancellationReason || "This order was canceled."};
    if (order.status === "Completed") return {icon: "bi-check-circle-fill", tone: "good", title: "Completed", text: "Thank you for ordering from Kopi; Calamba!"};
    if (order.status === "Ready for Pickup") return {icon: "bi-bag-check-fill", tone: "good", title: "Ready for pickup", text: "Your order is ready. You can pick it up at the store."};
    if (order.status === "Out for Delivery" || order.status === "Arrived") return {icon: "bi-truck", tone: "good", title: "Out for delivery", text: "A rider is on the way with your order."};
    if (order.specialDiscountStatus === "Not approved") return {icon: "bi-exclamation-circle-fill", tone: "warn", title: "Discount not approved", text: "Your ID could not be verified, so the order continues at the normal price."};
    if (order.status === "Preparing") return {icon: "bi-cup-hot-fill", tone: "good", title: "Preparing", text: "We are preparing your order."};
    if (order.payment === "GCash" && order.paymentStatus === "Pending verification") return {icon: "bi-hourglass-split", tone: "warn", title: "Checking your GCash payment", text: "We will start your order after the payment is confirmed."};
    if (order.specialDiscountStatus === "Pending verification") return {icon: "bi-hourglass-split", tone: "warn", title: "Checking your ID", text: "We will start your order after your ID is checked."};
    if (order.payment === "GCash" && order.paymentStatus === "Verified") return {icon: "bi-patch-check-fill", tone: "good", title: "GCash payment confirmed", text: "Your order is next in line."};
    return {icon: "bi-receipt", tone: "info", title: "Order received", text: pickup ? "We received your pickup order." : "We received your order."};
  }

  const when = value => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : String(value).replace(" ", "T") + "Z")
    .toLocaleString("en-PH", {timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"});

  function unseen() {
    const seen = readSeen() || {};
    return orders.filter(order => seen[order.id] !== signature(order));
  }

  function paintCount() {
    const number = unseen().length;
    count.textContent = number > 9 ? "9+" : String(number);
    count.hidden = number === 0;
    button.setAttribute("aria-label", number ? `Order updates, ${number} new` : "Order updates");
    button.classList.toggle("has-updates", number > 0);
  }

  function renderPanel() {
    if (!panel) return;
    const list = panel.querySelector(".bell-list");
    const fresh = new Set(unseen().map(order => order.id));
    list.replaceChildren();
    if (!orders.length) {
      const empty = document.createElement("li");
      empty.className = "bell-empty";
      empty.textContent = "No orders yet. Updates about your orders will show here.";
      list.append(empty);
      return;
    }
    orders.slice(0, 10).forEach(order => {
      const info = describe(order);
      const row = document.createElement("li");
      row.className = `bell-row is-${info.tone}${fresh.has(order.id) ? " is-new" : ""}`;
      const icon = document.createElement("i");
      icon.className = `bi ${info.icon}`;
      icon.setAttribute("aria-hidden", "true");
      const body = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `${order.orderNumber} · ${info.title}`;
      const text = document.createElement("p");
      text.textContent = info.text;
      const time = document.createElement("small");
      time.textContent = when(order.createdAt);
      body.append(title, text, time);
      row.append(icon, body);
      list.append(row);
    });
  }

  function markAllSeen() {
    const seen = {};
    orders.forEach(order => { seen[order.id] = signature(order); });
    writeSeen(seen);
  }

  function openPanel() {
    panel = document.createElement("dialog");
    panel.className = "bell-panel";
    panel.setAttribute("aria-labelledby", "bellTitle");
    panel.innerHTML = `<header><h2 id="bellTitle">Order updates</h2><button class="close-panel" type="button" aria-label="Close order updates"><i class="bi bi-x-lg" aria-hidden="true"></i></button></header>
      <ul class="bell-list"></ul>
      <a class="bell-all" href="Account.html#orders">View all my orders</a>`;
    panel.querySelector(".close-panel").addEventListener("click", () => panel.close());
    panel.addEventListener("click", event => { if (event.target === panel) panel.close(); });
    panel.addEventListener("close", () => {
      markAllSeen();
      paintCount();
      panel.remove();
      panel = null;
      button.focus();
    });
    document.body.append(panel);
    renderPanel();
    panel.showModal();
    refresh();
  }

  async function refresh() {
    if (!customer() || document.visibilityState !== "visible") return;
    try {
      const data = await KopiApi.request("/orders/my");
      orders = data.orders;
      const current = new Map(orders.map(order => [order.id, signature(order)]));
      // The very first visit starts clean instead of announcing every old order.
      if (!readSeen()) markAllSeen();
      // A change that just arrived also shows as a short notice.
      if (known && !panel) {
        const changed = orders.find(order => known.get(order.id) !== current.get(order.id) && known.has(order.id));
        if (changed) KopiNotice.toast(`${changed.orderNumber}: ${describe(changed).title}`, "info");
      }
      known = current;
      paintCount();
      renderPanel();
    } catch {
      // Offline or signed out: the next check tries again.
    }
  }

  button.addEventListener("click", () => {
    if (panel) panel.close();
    else openPanel();
  });
  window.setInterval(refresh, POLL_MS);
  window.addEventListener("focus", refresh);
  window.addEventListener("kopi:delivery-updated", refresh);
  document.addEventListener("visibilitychange", refresh);
  refresh();
})();
