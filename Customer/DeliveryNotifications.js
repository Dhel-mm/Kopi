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
    const link = KopiDeliveryInfo.trackingUrl(notification.trackingUrl);
    if (!link) return;
    const previousFocus = document.activeElement;
    current = notification;
    dialog = document.createElement("dialog");
    dialog.className = "delivery-notice";
    dialog.setAttribute("aria-labelledby", "deliveryNoticeTitle");
    dialog.setAttribute("aria-describedby", "deliveryNoticeMessage");
    const title = document.createElement("h2");
    title.id = "deliveryNoticeTitle";
    title.textContent = `Delivery details · ${notification.orderNumber}`;
    const message = document.createElement("p");
    message.id = "deliveryNoticeMessage";
    message.className = "delivery-notice-message";
    KopiDeliveryInfo.messageParts(notification.riderFee, link).forEach((text, index) => {
      const part = document.createElement("span");
      if (index === 1 || index === 3) part.className = "delivery-notice-value";
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
    dialog.append(title, message, track, status, ok);
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
        await KopiApi.request(`/orders/${notification.orderId}/delivery/acknowledge`, {
          method: "PATCH", body: JSON.stringify({revision: notification.revision})
        });
        dismiss();
        if (session()?.token === token) {
          window.dispatchEvent(new CustomEvent("kopi:delivery-updated"));
          if (previousFocus?.isConnected) previousFocus.focus();
        }
      } catch (error) {
        if (error.status === 401 || error.status === 404 || error.status === 409 || session()?.token !== token) dismiss();
        else KopiNotice.set(status, "Could not acknowledge delivery details. Please try OK again when connected.", "error");
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
      const data = await KopiApi.request("/orders/delivery-notifications");
      if (session()?.token !== active.token) { dismiss(); return; }
      if (acknowledging || document.visibilityState !== "visible") return;
      if (current && data.notifications.some(item => item.orderId === current.orderId && item.revision === current.revision)) return;
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
