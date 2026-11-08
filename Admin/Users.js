const rowsEl = document.getElementById("usersRows"),
  emptyEl = document.getElementById("usersEmpty");
const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
let users = [],
  page = 1,
  mode = "create",
  selectedId;
const size = 20;
// Archived accounts cannot sign in; their orders and history are kept.
const presence = user => user.status !== "Active" ? "Archived" : user.online ? "Online" : "Offline";
const isEmployeeLogin = user => ["Cashier", "Staff"].includes(user.role);
function renderUsers() {
  const role = document.getElementById("roleFilter").value,
    status = document.getElementById("statusFilter").value;
  const search = document
    .getElementById("userSearch")
    .value.trim()
    .toLowerCase();
  const visible = users.filter(
    (user) =>
      (user.name + " " + user.email).toLowerCase().includes(search) &&
      (role === "All" || user.role === role) &&
      (status === "All" || presence(user) === status),
  );
  const pages = Math.max(1, Math.ceil(visible.length / size));
  page = Math.max(1, Math.min(page, pages));
  document.getElementById("totalUsers").textContent = users.length;
  document.getElementById("activeUsers").textContent = users.filter(
    (user) => user.online,
  ).length;
  document.getElementById("inactiveUsers").textContent = users.filter(
    (user) => presence(user) === "Offline",
  ).length;
  document.getElementById("adminUsers").textContent = users.filter(
    (user) => user.role === "Admin",
  ).length;
  rowsEl.innerHTML = visible
    .slice((page - 1) * size, page * size)
    .map((user, index) => {
      const isEmployee = ["Admin", "Cashier", "Staff"].includes(user.role);
      const totalOrders = isEmployee ? "—" : user.totalOrders;
      const totalSpent = isEmployee ? "—" : `₱${Number(user.totalSpent).toFixed(2)}`;
      return `<tr><td>${(page - 1) * size + index + 1}</td><td>${escapeHtml(user.name)}</td>
    <td>${escapeHtml(user.email)}</td><td>${escapeHtml(user.phone || "—")}</td><td>${totalOrders}</td><td>${totalSpent}</td>
    <td>${escapeHtml(user.role)}</td><td>${String(user.createdAt).slice(0, 10)}</td>
    <td><span class="user-presence is-${presence(user).toLowerCase()}" title="${presence(user) === "Archived" ? "This account is archived and cannot sign in" : user.online ? "Active on a signed-in page within the last two minutes" : "No recent signed-in activity"}">${presence(user)}</span></td>
    <td><div class="user-actions">
    <button class="manage-user-btn" type="button" data-user="${user.id}" data-action="access" title="Manage user" aria-label="Manage ${escapeHtml(user.name)}"><i class="bi bi-person-gear" aria-hidden="true"></i></button>
    <button class="manage-user-btn" type="button" data-user="${user.id}" data-action="${isEmployeeLogin(user) ? "temporary" : "recover"}" title="${isEmployeeLogin(user) ? "Send a temporary password" : "Generate recovery code"}" aria-label="${isEmployeeLogin(user) ? "Temporary password" : "Recovery code"} for ${escapeHtml(user.name)}" ${user.status !== "Active" ? "disabled" : ""}><i class="bi bi-key" aria-hidden="true"></i></button></div></td></tr>`;
    })
    .join("");
  emptyEl.hidden = visible.length > 0;
  emptyEl.textContent = "No matching users.";
  document.getElementById("usersRange").textContent = visible.length
    ? "Showing " +
      ((page - 1) * size + 1) +
      "–" +
      Math.min(page * size, visible.length) +
      " of " +
      visible.length
    : "Showing 0 users";
  document.getElementById("usersPrevious").disabled = page === 1;
  document.getElementById("usersPage").textContent =
    page + "/" + pages;
  document.getElementById("usersNext").disabled = page === pages;
}
let refreshingUsers = false;
async function refreshUsers() {
  if (refreshingUsers) return;
  refreshingUsers = true;
  try {
    users = (await KopiApi.request("/admin/users")).users;
    renderUsers();
  } catch (error) {
    emptyEl.hidden = false;
    KopiNotice.set(emptyEl, error.message, "error");
    rowsEl.innerHTML = "";
  } finally {
    refreshingUsers = false;
  }
}
for (const id of ["userSearch", "roleFilter", "statusFilter"])
  document
    .getElementById(id)
    .addEventListener(id === "userSearch" ? "input" : "change", () => {
      page = 1;
      renderUsers();
    });
document.getElementById("usersPrevious").addEventListener("click", () => {
  page--;
  renderUsers();
});
document.getElementById("usersNext").addEventListener("click", () => {
  page++;
  renderUsers();
});
document.querySelectorAll("#userDialog [data-close-dialog]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
const dialog = document.getElementById("userDialog"),
  form = document.getElementById("userForm");
function openUser(action, user) {
  mode = action;
  selectedId = user?.id;
  form.reset();
  document.getElementById("saveUser").disabled = false;
  document.getElementById("userResult").textContent = "";
  const titles = {create: "Add user", recover: "Recovery code for ", temporary: "Temporary password for ", access: "Manage "};
  document.getElementById("userDialogTitle").textContent = titles[action] + (user?.name || "");
  document.getElementById("saveUser").textContent =
    {recover: "Generate recovery code", temporary: "Send temporary password", create: "Add user"}[action] || "Save";
  document.getElementById("archiveUserNote").textContent = action === "access" && user?.status !== "Active"
    ? "This account is archived and cannot sign in. Restore it to let this person sign in again."
    : action === "temporary" ? "A new temporary password is emailed to this person, and their current password stops working." : "";
  for (const [id, show] of [
    ["createUserFields", action === "create"],
    ["accessUserFields", action === "create" || action === "access"],
    ["recoveryIdentity", action === "recover"],
    ["archiveUserNote", action === "temporary" || (action === "access" && user?.status !== "Active")],
  ]) {
    const section = document.getElementById(id);
    section.hidden = !show;
    section
      .querySelectorAll("input,select")
      .forEach((input) => (input.disabled = !show));
  }
  // Manage shows the Active / Inactive choice, and also the Archive / Restore button.
  document.getElementById("userStatusLabel").hidden = action === "create";
  const archiveButton = document.getElementById("archiveUserBtn");
  archiveButton.hidden = action !== "access" || !user || user.id === KopiApi.getSession()?.user?.id;
  archiveButton.disabled = false;
  archiveButton.innerHTML = user?.status === "Active"
    ? `<i class="bi bi-archive" aria-hidden="true"></i> Archive user`
    : `<i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i> Restore user`;
  archiveButton.classList.toggle("is-restore", user?.status !== "Active");
  // Customers sign up on the website, so "Customer" is offered only when managing a customer account.
  form.elements.role.querySelector("option[value='Customer']")?.remove();
  if (user?.role === "Customer") form.elements.role.prepend(new Option("Customer", "Customer"));
  if (user) {
    form.elements.role.value = user.role;
    form.elements.status.value = user.status;
  }
  dialog.showModal();
}
document
  .getElementById("addUser")
  .addEventListener("click", () => openUser("create"));
document
  .getElementById("closeUserDialog")
  .addEventListener("click", () => dialog.close());
// Archive (or restore) from inside Manage. It uses the same administrator password box.
document.getElementById("archiveUserBtn").addEventListener("click", async () => {
  const user = users.find((entry) => entry.id === selectedId);
  if (!user) return;
  const result = document.getElementById("userResult");
  if (!form.elements.currentPassword.value) {
    KopiNotice.set(result, "Enter your administrator password to confirm.", "error");
    form.elements.currentPassword.focus();
    return;
  }
  const archiving = user.status === "Active";
  if (archiving && !await KopiNotice.confirm(`${user.name} will no longer be able to sign in. Their account, orders and records are kept, and you can restore it from Manage at any time.`, {title: "Archive this user?", confirmText: "Archive", danger: true})) return;
  mode = archiving ? "archive" : "restore";
  document.getElementById("archiveUserBtn").disabled = true;
  form.requestSubmit();
});
rowsEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-user]");
  if (!button) return;
  const user = users.find((user) => user.id === Number(button.dataset.user));
  if (user) openUser(button.dataset.action, user);
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.getElementById("saveUser"),
    result = document.getElementById("userResult");
  const body = Object.fromEntries(new FormData(form));
  const editingOwnAccess =
    mode === "access" && selectedId === KopiApi.getSession()?.user?.id;
  button.disabled = true;
  try {
    if (mode === "recover")
      body.identityConfirmed = form.elements.identityConfirmed.checked;
    // Archiving keeps the role and only changes whether the account can sign in.
    if (mode === "archive" || mode === "restore") {
      body.role = users.find((user) => user.id === selectedId)?.role;
      body.status = mode === "archive" ? "Inactive" : "Active";
    }
    const endpoint =
      mode === "create"
        ? "/admin/users"
        : "/admin/users/" +
          selectedId +
          (mode === "recover" ? "/recovery-code" : mode === "temporary" ? "/temporary-password" : "");
    const data = await KopiApi.request(endpoint, {
      method: ["access", "archive", "restore"].includes(mode) ? "PATCH" : "POST",
      body: JSON.stringify(body),
    });
    form.elements.currentPassword.value = "";
    result.textContent = data.message;
    if (mode === "recover" || data.temporaryPassword) {
      const code = document.createElement("strong");
      code.className = "recovery-code";
      code.textContent = data.code || data.temporaryPassword;
      result.prepend(code);
      refreshUsers();
      return;
    }
    if (mode === "temporary" || mode === "create") KopiNotice.toast(data.message, "success");
    if (editingOwnAccess) {
      KopiApi.clearSession();
      window.location.href = "../login.html";
      return;
    }
    dialog.close();
    await refreshUsers();
  } catch (error) {
    KopiNotice.set(result, error.message, "error");
    button.disabled = false;
    // An archive started from Manage goes back to Manage, so Save keeps its own meaning.
    if (mode === "archive" || mode === "restore") {
      mode = "access";
      document.getElementById("archiveUserBtn").disabled = false;
    }
  }
});
async function refreshFeedback() {
  const target = document.getElementById("adminFeedback");
  try {
    const data = await KopiApi.request("/admin/feedback");
    target.innerHTML =
      data.feedback
        .map(
          (
            row,
          ) => `<details><summary>${escapeHtml(row.customer)} — ${row.rating}/5 — ${escapeHtml(row.createdAt)} UTC</summary>
      <p><strong>Improve:</strong> ${escapeHtml(row.improveComment)}</p><p><strong>Liked:</strong> ${escapeHtml(row.likedComment)}</p>
      <p><strong>Visit frequency:</strong> ${escapeHtml(row.visitFrequency)}</p><p>${escapeHtml(row.additionalComment)}</p></details>`,
        )
        .join("") || "<p>No feedback yet.</p>";
  } catch (error) {
    target.textContent = error.message;
  }
}
window.addEventListener("focus", () => {
  refreshUsers();
  refreshFeedback();
});
refreshUsers();
refreshFeedback();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshUsers();
});
window.setInterval(() => {
  if (document.visibilityState === "visible") refreshUsers();
}, 30000);
