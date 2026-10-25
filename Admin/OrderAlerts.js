// Pop-up and sound when an order needs attention, so the team hears it even
// away from the screen. Staff: new online orders. Admin: GCash payments and
// Senior Citizen / PWD IDs to verify. The chime repeats until someone responds.
(() => {
  const role = KopiApi.getSession()?.user?.role;
  const handover = iso => iso ? new Date(iso).toLocaleString("en-PH", {timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}) : "As soon as possible";
  const config = {
    Staff: {
      url: "/workforce/alerts", page: "/Staff/Orders.html", open: "View orders",
      title: count => count === 1 ? "New order" : `${count} new orders`,
      items: data => data.orders.map(order => ({
        key: `order:${order.id}:${order.createdAt}`,
        title: `${order.orderNumber} · ${order.serviceType === "Pickup" ? "Pickup" : "Delivery"}`,
        detail: `${order.customer} · ${order.serviceType === "Pickup" ? "Pickup" : "Rider pickup"}: ${handover(order.scheduledFor)}`
      }))
    },
    Admin: {
      url: "/admin/alerts", page: "/Admin/Operation.html", open: "Open Operations",
      title: count => count === 1 ? "Needs verification" : `${count} items need verification`,
      items: data => data.orders.flatMap(order => order.needs.map(need => ({
        key: `${need}:${order.id}:${order.createdAt}`,
        title: `${order.orderNumber} · Verify ${need}`,
        detail: `${order.customer} · ₱${Number(order.total).toFixed(2)}`
      })))
    }
  }[role];
  if (!config) return;

  const REPEAT_MS = 20000;
  const POLL_MS = 10000;
  const seenKey = `kopi_alerts_seen_${role}`;
  const baseTitle = document.title;
  let seen;
  try { seen = new Set(JSON.parse(localStorage.getItem(seenKey) || "[]")); } catch { seen = new Set(); }
  let showing = new Map();
  let audio = null;
  let repeatTimer = null;
  let panel = null;

  function remember() {
    try { localStorage.setItem(seenKey, JSON.stringify([...seen].slice(-300))); } catch {}
  }

  // Browsers only allow sound after someone clicks or types on the page.
  function audioContext() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    audio = audio || new Context();
    return audio;
  }
  function unlock() {
    const context = audioContext();
    context?.resume?.().then(syncSoundButton).catch(() => {});
  }
  function chime() {
    const context = audioContext();
    if (!context || context.state !== "running") return;
    const start = context.currentTime;
    [880, 1175, 1568].forEach((frequency, index) => {
      const tone = context.createOscillator();
      const volume = context.createGain();
      tone.type = "sine";
      tone.frequency.value = frequency;
      const at = start + index * 0.18;
      volume.gain.setValueAtTime(0.0001, at);
      volume.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      tone.connect(volume).connect(context.destination);
      tone.start(at);
      tone.stop(at + 0.55);
    });
  }

  // A small button stays visible until sound is allowed on this page.
  const soundButton = document.createElement("button");
  soundButton.type = "button";
  soundButton.className = "order-alert-sound";
  soundButton.innerHTML = '<i class="bi bi-volume-up-fill" aria-hidden="true"></i><span>Turn on order sounds</span>';
  soundButton.addEventListener("click", () => {
    unlock();
    setTimeout(chime, 150);
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
  });
  function syncSoundButton() {
    soundButton.hidden = audio?.state === "running";
  }
  ["pointerdown", "keydown"].forEach(type => document.addEventListener(type, unlock, {capture: true}));

  function close(markSeen) {
    if (markSeen) { showing.forEach((item, key) => seen.add(key)); remember(); }
    showing = new Map();
    clearInterval(repeatTimer);
    repeatTimer = null;
    panel?.remove();
    panel = null;
    document.title = baseTitle;
  }

  function render() {
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "order-alert";
      panel.setAttribute("role", "alert");
      panel.innerHTML = `<header><span class="order-alert-icon"><i class="bi bi-bell-fill" aria-hidden="true"></i></span><h2></h2>
        <button class="close-panel" type="button" aria-label="Dismiss alert"><i class="bi bi-x-lg" aria-hidden="true"></i></button></header>
        <ul></ul><div class="order-alert-actions"><a class="order-alert-open"></a><button class="order-alert-ok" type="button">Got it</button></div>`;
      panel.querySelector(".close-panel").addEventListener("click", () => close(true));
      panel.querySelector(".order-alert-ok").addEventListener("click", () => close(true));
      const open = panel.querySelector(".order-alert-open");
      open.href = config.page;
      open.textContent = config.open;
      open.addEventListener("click", () => close(true));
      document.body.append(panel);
    }
    panel.querySelector("h2").textContent = config.title(showing.size);
    const list = panel.querySelector("ul");
    list.replaceChildren(...[...showing.values()].map(item => {
      const row = document.createElement("li");
      const title = document.createElement("strong");
      title.textContent = item.title;
      const detail = document.createElement("small");
      detail.textContent = item.detail;
      row.append(title, detail);
      return row;
    }));
    document.title = `(${showing.size}) ${config.title(showing.size)} · ${baseTitle}`;
  }

  function notify(items) {
    items.forEach(item => showing.set(item.key, item));
    render();
    chime();
    clearInterval(repeatTimer);
    repeatTimer = setInterval(chime, REPEAT_MS);
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      try { new Notification(config.title(showing.size), {body: items.map(item => item.title).join("\n"), tag: seenKey}); } catch {}
    }
  }

  async function check() {
    try {
      const items = config.items(await KopiApi.request(config.url));
      const waiting = new Set(items.map(item => item.key));
      // Orders handled elsewhere leave the pop-up; it closes when nothing is left.
      showing.forEach((item, key) => { if (!waiting.has(key)) showing.delete(key); });
      const fresh = items.filter(item => !seen.has(item.key) && !showing.has(item.key));
      if (fresh.length) notify(fresh);
      else if (panel && !showing.size) close(false);
      else if (panel) render();
    } catch {}
  }

  function showSoundButton() {
    document.body.append(soundButton);
    syncSoundButton();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showSoundButton);
  else showSoundButton();
  check();
  // Keep checking while the tab is in the background so the chime still plays.
  setInterval(check, POLL_MS);
})();
