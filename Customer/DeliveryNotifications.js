/* One shared inbox on every customer page; acknowledgements live in the order DB. */
(() => {
  let checking = false;
  let acknowledging = false;
  let current = null;
  let dialog = null;
  let ownerToken = null;

  function session() {
    const value = KopiApi.getSession();
    return value?.user?.role === "Customer" && value.token ? value : null;
  }
  function dismiss() {
    if (dialog) { dialog.close(); dialog.remove(); }
    dialog = null;
    current = null;
  }
  function show(notification, token) {
    // Cancellation, "discount not approved" and "ready for pickup" notices are text only.
    const discount = notification.type === "discount";
    const pickup = notification.type === "pickup";
    const canceled = notification.type === "cancellation" || discount || pickup;
    const link = KopiDeliveryInfo.trackingUrl(notification.trackingUrl);
    if (!canceled && !link) return;
    const previousFocus = document.activeElement;
    current = notification;
    dialog = document.createElement("dialog");
    dialog.className = canceled && !pickup ? "delivery-notice cancellation-notice" : "delivery-notice";
    dialog.setAttribute("aria-labelledby", "deliveryNoticeTitle");
    dialog.setAttribute("aria-describedby", "deliveryNoticeMessage");
    const title = document.createElement("h2");
    title.id = "deliveryNoticeTitle";
    title.textContent = `${pickup ? "Ready for pickup" : discount ? "Discount not approved" : canceled ? "Order canceled" : "Delivery details"} · ${notification.orderNumber}`;
    if (pickup) dialog.classList.add("pickup-notice");
    const message = document.createElement("p");
    message.id = "deliveryNoticeMessage";
    message.className = "delivery-notice-message";
    if (pickup) {
      String(notification.message || "").split(/(Please pay ₱[\d,.]+ at the counter\.)/).forEach((text, index) => {
        if (!text) return;
        const part = document.createElement("span");
        if (index % 2 === 1) part.className = "delivery-notice-value discount-notice-key";
        part.textContent = text;
        message.appendChild(part);
      });
    } else if (discount) {
      // Bold, gold key points: the discount removed and what to pay the rider.
      const key = /(\(the ₱[\d,.]+ discount was removed\)|[Pp]lease pay (?:the remaining )?₱[\d,.]+ (?:in cash )?to the rider\.)/;
      String(notification.message || "").split(key).forEach((text, index) => {
        if (!text) return;
        const part = document.createElement("span");
        if (index % 2 === 1) part.className = "delivery-notice-value discount-notice-key";
        part.textContent = text;
        message.appendChild(part);
      });
    } else if (canceled) message.textContent = notification.message;
    else KopiDeliveryInfo.messageParts(notification.riderFee, link, notification.payment, notification.total).forEach((text, index) => {
      const part = document.createElement("span");
      if (index % 2 === 1) part.className = "delivery-notice-value";
      part.textContent = text;
      message.appendChild(part);
    });
    const track = document.createElement("a");
    track.href = link;
    track.target = "_blank";
    track.rel = "noopener noreferrer";
    track.textContent = "Open live tracking";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    const ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = "OK";
    dialog.append(title, message);
    if (!canceled) dialog.append(track);
    dialog.append(status, ok);
    // Closing with Escape must not silently acknowledge delivery information.
    dialog.addEventListener("cancel", event => event.preventDefault());
    document.body.appendChild(dialog);
    dialog.showModal();
    ok.focus();
    ok.addEventListener("click", async () => {
      if (acknowledging) return;
      if (session()?.token !== token) { dismiss(); return; }
      acknowledging = true;
      ok.disabled = true;
      try {
        await KopiApi.request(`/orders/${notification.orderId}/${pickup ? "pickup" : discount ? "discount" : canceled ? "cancellation" : "delivery"}/acknowledge`, {
          method: "PATCH", body: JSON.stringify({revision: notification.revision})
        });
        dismiss();
        if (session()?.token === token) {
          window.dispatchEvent(new CustomEvent("kopi:delivery-updated"));
          if (previousFocus?.isConnected) previousFocus.focus();
        }
      } catch (error) {
        if (error.status === 401 || error.status === 404 || error.status === 409 || session()?.token !== token) dismiss();
        else KopiNotice.set(status, "Could not acknowledge this notice. Please try OK again when connected.", "error");
      } finally {
        acknowledging = false;
        ok.disabled = false;
        if (!current) check();
      }
    });
  }

  async function check() {
    const active = session();
    if (!active || (ownerToken && ownerToken !== active.token)) dismiss();
    ownerToken = active?.token || null;
    if (!active || document.visibilityState !== "visible" || checking || acknowledging) return;
    checking = true;
    try {
      const data = await KopiApi.request("/orders/notifications");
      if (session()?.token !== active.token) { dismiss(); return; }
      if (acknowledging || document.visibilityState !== "visible") return;
      if (current && data.notifications.some(item => item.orderId === current.orderId && item.revision === current.revision && item.type === current.type)) return;
      dismiss();
      // Let an existing modal finish; the next check will deliver this notification.
      if (document.querySelector("dialog[open]")) return;
      if (data.notifications.length) {
        show(data.notifications[0], active.token);
        window.dispatchEvent(new CustomEvent("kopi:delivery-updated"));
      }
    } catch (error) {
      if (error.status === 401 || error.status === 403) dismiss();
      // Offline pages retry on focus / the next interval without a toast loop.
    } finally { checking = false; }
  }
  window.setInterval(check, 15000);
  window.addEventListener("focus", check);
  window.addEventListener("pageshow", check);
  window.addEventListener("storage", check);
  document.addEventListener("visibilitychange", check);
  check();
})();
