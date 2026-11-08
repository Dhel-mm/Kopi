// Pop-up and sound when an order needs attention, so the team hears it even
// away from the screen. Staff: new online orders. Cashier and Admin: GCash payments
// and Senior Citizen / PWD IDs to verify. The chime repeats until someone responds.
(() => {
  const role = KopiApi.getSession()?.user?.role;
  const handover = (iso, pickup) => iso ? new Date(iso).toLocaleString("en-PH", {timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}) : pickup ? "Priority Pickup" : "Priority Delivery";
  const config = {
    Staff: {
      url: "/workforce/alerts", page: "/Staff/Orders.html", open: "View orders",
      title: count => count === 1 ? "New order" : `${count} new orders`,
      items: data => data.orders.map(order => order.orderType === "In-store" ? {
        key: `order:${order.id}:${order.createdAt}`,
        title: `${order.orderNumber} · Walk-in ${order.serviceType || "order"}`,
        detail: `${order.customer} · from the cashier`
      } : {
        key: `order:${order.id}:${order.createdAt}`,
        title: `${order.orderNumber} · ${order.serviceType === "Pickup" ? "Pickup" : "Delivery"}`,
        detail: `${order.customer} · ${order.serviceType === "Pickup" ? "Pickup" : "Rider pickup"}: ${handover(order.scheduledFor, order.serviceType === "Pickup")}`
      })
    },
    Cashier: {
      url: "/workforce/verification-alerts", page: "/Cashier/Verify.html", open: "Open Verify payments",
      title: count => count === 1 ? "Needs verification" : `${count} items need verification`,
      items: data => data.orders.flatMap(order => order.needs.map(need => ({
        key: `${need}:${order.id}:${order.createdAt}`,
        title: `${order.orderNumber} · Verify ${need}`,
        detail: `${order.customer} · ₱${Number(order.total).toFixed(2)}`
      })))
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

  // ---------- Alert sounds (chosen in Settings > Order alerts > Alert sound) ----------
  // Built-in sounds are made by the browser, so no files are needed.
  // Each note is [pitch in Hz, start in seconds, length in seconds].
  const TONES = {
    chime: {label: "Chime (default)", wave: "sine", notes: [[880, 0, 0.5], [1175, 0.18, 0.5], [1568, 0.36, 0.5]]},
    bell: {label: "Counter bell", wave: "triangle", notes: [[1319, 0, 1.2], [1976, 0, 0.9], [2637, 0, 0.5]]},
    dingdong: {label: "Ding-dong", wave: "sine", notes: [[988, 0, 0.6], [784, 0.35, 0.9]]},
    beep: {label: "Double beep", wave: "square", notes: [[1000, 0, 0.12], [1000, 0.2, 0.12]], loudness: 0.5},
    pop: {label: "Soft pop", wave: "sine", notes: [[660, 0, 0.15], [990, 0.12, 0.25]]},
    rise: {label: "Rising tones", wave: "triangle", notes: [[523, 0, 0.25], [659, 0.15, 0.25], [784, 0.3, 0.25], [1047, 0.45, 0.45]]}
  };
  // Your own sound files: put the file in Admin/sounds/ and add a line here,
  // for example {id: "shop-bell", label: "Shop bell", src: "/Admin/sounds/shop-bell.mp3"}.
  const SOUND_FILES = [
  ];
  const SOUNDS = {...TONES};
  SOUND_FILES.forEach(file => { SOUNDS[file.id] = {label: file.label, src: file.src}; });

  // Choices saved on this device in Settings: sound, which sound, volume, repeating and desktop notifications.
  const PREFS_KEY = "kopi_alert_prefs";
  function prefs() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}; } catch {}
    const volume = Number(saved.volume);
    return {sound: saved.sound !== false, tone: SOUNDS[saved.tone] ? saved.tone : "chime",
      volume: Number.isFinite(volume) ? Math.min(1, Math.max(0.05, volume)) : 0.35,
      repeat: saved.repeat !== false, desktop: saved.desktop !== false};
  }

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
    context?.resume?.().catch(() => {});
  }
  function chime(force = false, soundId = null) {
    const settings = prefs();
    if (!force && !settings.sound) return;
    const sound = SOUNDS[soundId] || SOUNDS[settings.tone] || SOUNDS.chime;
    // A sound file plays through an audio element at the chosen volume.
    if (sound.src) {
      const player = new Audio(sound.src);
      player.volume = settings.volume;
      player.play().catch(() => {});
      return;
    }
    const context = audioContext();
    if (!context || context.state !== "running") return;
    const start = context.currentTime;
    const peak = Math.max(0.0002, settings.volume * (sound.loudness || 1));
    sound.notes.forEach(([frequency, offset, length]) => {
      const tone = context.createOscillator();
      const volume = context.createGain();
      tone.type = sound.wave;
      tone.frequency.value = frequency;
      const at = start + offset;
      volume.gain.setValueAtTime(0.0001, at);
      volume.gain.exponentialRampToValueAtTime(peak, at + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.0001, at + length);
      tone.connect(volume).connect(context.destination);
      tone.start(at);
      tone.stop(at + length + 0.05);
    });
  }

  // Sound is switched on and off in Settings. Browsers allow it after the first click or key press on the page.
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
    if (prefs().repeat) repeatTimer = setInterval(chime, REPEAT_MS);
    if (prefs().desktop && document.hidden && "Notification" in window && Notification.permission === "granted") {
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

  // Used by the Settings page to test the sound and apply changes right away.
  window.KopiOrderAlerts = {
    prefsKey: PREFS_KEY,
    prefs,
    sounds: Object.entries(SOUNDS).map(([id, sound]) => ({id, label: sound.label})),
    test(soundId) { unlock(); setTimeout(() => chime(true, soundId), 150); },
    applied() { if (!prefs().repeat) { clearInterval(repeatTimer); repeatTimer = null; } }
  };
  check();
  // Keep checking while the tab is in the background so the chime still plays.
  setInterval(check, POLL_MS);
})();
