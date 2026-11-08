/* Settings for Admin, Staff and Cashier: profile, password, order alerts on this
   device, and signing out everywhere. The server checks every account change. */
(() => {
  "use strict";
  const root = document.getElementById("settingsRoot");
  const role = KopiApi.getSession()?.user?.role || "";
  const hasAlerts = ["Admin", "Cashier", "Staff"].includes(role);
  const alertWhat = role === "Staff" ? "new online orders" : "GCash payments and Senior Citizen / PWD IDs to verify";
  let user = null;

  const switchRow = (id, title, note) => `<label class="settings-switch" for="${id}">
      <span><strong>${title}</strong><small>${note}</small></span>
      <input type="checkbox" id="${id}"><span class="settings-switch-track" aria-hidden="true"></span></label>`;

  root.innerHTML = `<div class="settings-grid">
    <section class="settings-card" aria-labelledby="profileTitle">
      <header class="settings-head"><i class="bi bi-person-badge" aria-hidden="true"></i><div><h2 id="profileTitle">Profile</h2><p>Your name and photo show in the header and on the orders you handle.</p></div></header>
      <div class="settings-photo">
        <span class="settings-avatar" id="settingsAvatar"><i class="bi bi-person-circle" aria-hidden="true"></i></span>
        <div class="settings-photo-actions">
          <label class="settings-btn ghost" for="settingsPhoto"><i class="bi bi-upload" aria-hidden="true"></i>Upload photo</label>
          <input id="settingsPhoto" type="file" accept="image/png,image/jpeg" hidden>
          <button class="settings-link" type="button" id="removePhoto">Remove photo</button>
          <small>PNG or JPEG, up to 250 KB.</small>
        </div>
      </div>
      <form class="settings-form" id="profileForm" novalidate>
        <label>First name<input name="firstName" autocomplete="given-name" maxlength="100" required></label>
        <label>Last name<input name="lastName" autocomplete="family-name" maxlength="100" required></label>
        <label>Phone number<input name="phone" type="tel" inputmode="numeric" maxlength="11" placeholder="09XXXXXXXXX" autocomplete="tel"></label>
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label class="settings-wide" id="emailPasswordField" hidden>Current password<small>Needed to change your email.</small><input name="currentPassword" type="password" autocomplete="current-password"></label>
        <div class="settings-actions settings-wide"><button class="settings-btn" type="submit">Save profile</button><p class="settings-status" role="status"></p></div>
      </form>
    </section>

    <section class="settings-card" aria-labelledby="passwordTitle">
      <header class="settings-head"><i class="bi bi-shield-lock" aria-hidden="true"></i><div><h2 id="passwordTitle">Password</h2><p>Use at least 8 characters. Changing it signs you out on other devices.</p></div></header>
      <form class="settings-form" id="passwordForm" novalidate>
        <label class="settings-wide">Current password<input name="currentPassword" type="password" autocomplete="current-password" required></label>
        <label>New password<input name="newPassword" type="password" autocomplete="new-password" minlength="8" required></label>
        <label>Confirm new password<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required></label>
        <label class="settings-check settings-wide"><input type="checkbox" id="showPasswords"> Show passwords</label>
        <div class="settings-actions settings-wide"><button class="settings-btn" type="submit">Change password</button><p class="settings-status" role="status"></p></div>
      </form>
    </section>

    ${hasAlerts ? `<section class="settings-card" aria-labelledby="alertsTitle">
      <header class="settings-head"><i class="bi bi-bell" aria-hidden="true"></i><div><h2 id="alertsTitle">Order alerts</h2><p>The pop-up and chime for ${alertWhat}. Saved on this device only.</p></div></header>
      <div class="settings-list">
        ${switchRow("alertSound", "Play a sound", "Chime when something new needs attention. Browsers start allowing sound after your first click on the page.")}
        <div class="settings-range settings-tone-row"><span><strong>Alert sound</strong><small>Pick the sound that plays for new alerts.</small></span>
          <span class="settings-tone"><span class="settings-select"><select id="alertTone" aria-label="Alert sound"></select><i class="bi bi-chevron-down" aria-hidden="true"></i></span>
          <button class="settings-btn ghost" type="button" id="previewTone"><i class="bi bi-play-fill" aria-hidden="true"></i>Play</button></span></div>
        <label class="settings-range" for="alertVolume"><span><strong>Volume</strong><small id="alertVolumeText">35%</small></span>
          <input type="range" id="alertVolume" min="5" max="100" step="5"></label>
        ${switchRow("alertRepeat", "Repeat until someone responds", "Chime again every 20 seconds until the pop-up is closed.")}
        ${switchRow("alertDesktop", "Desktop notifications", "Show a notice when this tab is in the background.")}
        <p class="settings-note" id="desktopNote" hidden></p>
      </div>
      <div class="settings-actions"><button class="settings-btn ghost" type="button" id="testSound"><i class="bi bi-volume-up" aria-hidden="true"></i>Test sound</button><p class="settings-status" id="alertsStatus" role="status"></p></div>
    </section>` : ""}

    <section class="settings-card" aria-labelledby="sessionTitle">
      <header class="settings-head"><i class="bi bi-box-arrow-right" aria-hidden="true"></i><div><h2 id="sessionTitle">Signing in</h2><p>Signed in as <strong id="sessionEmail">…</strong> · <span id="sessionRole">${role}</span></p></div></header>
      <p class="settings-copy">Lost a device or used a shared computer? Sign out everywhere, then sign in again here.</p>
      <div class="settings-actions"><button class="settings-btn danger" type="button" id="signOutAll"><i class="bi bi-box-arrow-right" aria-hidden="true"></i>Sign out of all devices</button></div>
    </section>
  </div>`;

  const profileForm = document.getElementById("profileForm");
  const passwordForm = document.getElementById("passwordForm");
  const statusOf = form => form.querySelector(".settings-status");

  // Keep the page header (admin or workspace) in step with saved changes.
  function syncHeader() {
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
    document.querySelectorAll("[data-worker-name]").forEach(node => { node.textContent = name; });
    const adminName = document.querySelector(".admin-profile:not(.workspace-profile) .profile-text strong");
    if (adminName) adminName.textContent = user.firstName;
    const adminAvatar = document.querySelector(".admin-header-avatar");
    if (adminAvatar) KopiProfile.avatar(adminAvatar, user.avatar);
    const workerAvatar = document.querySelector(".workspace-profile [data-avatar], .workspace-profile .workspace-avatar");
    if (workerAvatar) {
      if (user.avatar) {
        const img = document.createElement("img");
        img.className = "workspace-avatar"; img.alt = "Your profile photo"; img.src = user.avatar;
        workerAvatar.replaceWith(img);
      } else if (workerAvatar.tagName === "IMG") {
        const icon = document.createElement("i");
        icon.className = "bi bi-person-circle"; icon.dataset.avatar = ""; icon.setAttribute("aria-hidden", "true");
        workerAvatar.replaceWith(icon);
      }
    }
    try { localStorage.setItem("kopi_admin_profile_changed", Date.now() + ":" + Math.random()); } catch {}
  }

  function fill() {
    for (const key of ["firstName", "lastName", "phone", "email"]) profileForm.elements[key].value = user[key] || "";
    KopiProfile.avatar(document.getElementById("settingsAvatar"), user.avatar);
    document.getElementById("removePhoto").hidden = !user.avatar;
    document.getElementById("sessionEmail").textContent = user.email;
    document.getElementById("emailPasswordField").hidden = true;
  }

  async function load() {
    try { user = (await KopiApi.request("/me")).user; fill(); }
    catch (error) { KopiNotice.set(statusOf(profileForm), error.message, "error"); }
  }

  profileForm.elements.email.addEventListener("input", () => {
    document.getElementById("emailPasswordField").hidden = !user || profileForm.elements.email.value.trim().toLowerCase() === user.email;
  });
  profileForm.addEventListener("submit", async event => {
    event.preventDefault();
    const status = statusOf(profileForm), button = profileForm.querySelector('[type="submit"]');
    button.disabled = true;
    KopiNotice.set(status, "Saving…", "loading");
    try {
      const result = await KopiProfile.save(profileForm);
      user = result.user;
      fill(); syncHeader();
      KopiNotice.set(status, result.message || "Profile saved.", "success");
    } catch (error) { KopiNotice.set(status, error.message, "error"); }
    finally { button.disabled = false; }
  });

  document.getElementById("settingsPhoto").addEventListener("change", async event => {
    const status = statusOf(profileForm);
    try {
      const result = await KopiProfile.upload(event.target.files[0]);
      user.avatar = result.avatar; fill(); syncHeader();
      KopiNotice.set(status, result.message, "success");
    } catch (error) { KopiNotice.set(status, error.message, "error"); }
    finally { event.target.value = ""; }
  });
  document.getElementById("removePhoto").addEventListener("click", async () => {
    const status = statusOf(profileForm);
    try {
      const result = await KopiApi.request("/me/avatar", {method: "DELETE"});
      user.avatar = null; fill(); syncHeader();
      KopiNotice.set(status, result.message, "success");
    } catch (error) { KopiNotice.set(status, error.message, "error"); }
  });

  document.getElementById("showPasswords").addEventListener("change", event => {
    passwordForm.querySelectorAll('input[type="password"], input[data-was-password]').forEach(input => {
      input.dataset.wasPassword = "";
      input.type = event.target.checked ? "text" : "password";
    });
  });
  passwordForm.addEventListener("submit", async event => {
    event.preventDefault();
    const status = statusOf(passwordForm), button = passwordForm.querySelector('[type="submit"]');
    if (!passwordForm.elements.currentPassword.value) return KopiNotice.set(status, "Enter your current password.", "error");
    button.disabled = true;
    KopiNotice.set(status, "Changing password…", "loading");
    try {
      const result = await KopiProfile.save(passwordForm);
      user = result.user;
      KopiNotice.set(status, "Password changed. Other devices have been signed out.", "success");
    } catch (error) { KopiNotice.set(status, error.message, "error"); }
    finally { button.disabled = false; }
  });

  document.getElementById("signOutAll").addEventListener("click", async event => {
    const button = event.currentTarget;
    if (!await KopiNotice.confirm("You will be signed out on every device, including this one.", {title: "Sign out everywhere?", confirmText: "Sign out", danger: true})) return;
    button.disabled = true;
    try { await KopiApi.logout(); KopiNotice.toast("Signed out of all devices.", "success"); }
    catch { KopiNotice.toast("Signed out here. The server could not be reached to sign out other devices.", "warning"); }
    setTimeout(() => window.location.replace("../login.html"), 1200);
  });

  // ---------- Order alert preferences (this device) ----------
  if (hasAlerts) {
    const key = window.KopiOrderAlerts?.prefsKey || "kopi_alert_prefs";
    const read = () => window.KopiOrderAlerts?.prefs() || {sound: true, tone: "chime", volume: 0.35, repeat: true, desktop: true};
    const tone = document.getElementById("alertTone");
    tone.replaceChildren(...(window.KopiOrderAlerts?.sounds || [{id: "chime", label: "Chime (default)"}]).map(item => new Option(item.label, item.id)));
    const sound = document.getElementById("alertSound"), volume = document.getElementById("alertVolume");
    const repeat = document.getElementById("alertRepeat"), desktop = document.getElementById("alertDesktop");
    const note = document.getElementById("desktopNote");
    function showDesktopNote() {
      const supported = "Notification" in window;
      const permission = supported ? Notification.permission : "unsupported";
      note.hidden = !desktop.checked || permission === "granted";
      note.textContent = permission === "denied" ? "This browser blocked notifications for the site. Allow them in the browser's site settings."
        : permission === "unsupported" ? "This browser does not support desktop notifications."
        : "The browser will ask for permission. Choose Allow.";
    }
    function render() {
      const prefs = read();
      sound.checked = prefs.sound; repeat.checked = prefs.repeat; desktop.checked = prefs.desktop;
      tone.value = prefs.tone;
      tone.disabled = !prefs.sound;
      volume.value = Math.round(prefs.volume * 100);
      volume.disabled = !prefs.sound;
      document.getElementById("alertVolumeText").textContent = `${volume.value}%`;
      showDesktopNote();
    }
    function save() {
      try {
        localStorage.setItem(key, JSON.stringify({sound: sound.checked, tone: tone.value, volume: Number(volume.value) / 100, repeat: repeat.checked, desktop: desktop.checked}));
      } catch {}
      window.KopiOrderAlerts?.applied();
      render();
      KopiNotice.set(document.getElementById("alertsStatus"), "Saved on this device.", "success");
    }
    [sound, repeat].forEach(input => input.addEventListener("change", save));
    volume.addEventListener("input", () => { document.getElementById("alertVolumeText").textContent = `${volume.value}%`; });
    volume.addEventListener("change", save);
    desktop.addEventListener("change", async () => {
      if (desktop.checked && "Notification" in window && Notification.permission === "default") {
        try { await Notification.requestPermission(); } catch {}
      }
      save();
    });
    // Changing the sound saves it and plays it straight away.
    tone.addEventListener("change", () => { save(); window.KopiOrderAlerts?.test(tone.value); });
    document.getElementById("previewTone").addEventListener("click", () => window.KopiOrderAlerts?.test(tone.value));
    document.getElementById("testSound").addEventListener("click", () => {
      if (window.KopiOrderAlerts) window.KopiOrderAlerts.test();
      KopiNotice.set(document.getElementById("alertsStatus"), "Playing the test chime. Check your speakers if you hear nothing.", "info");
    });
    render();
  }

  load();
})();
