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
      (status === "All" || (user.online ? "Online" : "Offline") === status),
  );
  const pages = Math.max(1, Math.ceil(visible.length / size));
  page = Math.max(1, Math.min(page, pages));
  document.getElementById("totalUsers").textContent = users.length;
  document.getElementById("activeUsers").textContent = users.filter(
    (user) => user.online,
  ).length;
  document.getElementById("inactiveUsers").textContent = users.filter(
    (user) => !user.online,
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
    <td><span class="user-presence ${user.online ? "is-online" : "is-offline"}" title="${user.online ? "Active on a signed-in page within the last two minutes" : "No recent signed-in activity"}">${user.online ? "Online" : "Offline"}</span></td>
    <td><div class="user-actions">
    <button class="manage-user-btn" type="button" data-user="${user.id}" data-action="access" title="Manage user" aria-label="Manage ${escapeHtml(user.name)}"><i class="bi bi-person-gear" aria-hidden="true"></i></button>
    <button class="manage-user-btn" type="button" data-user="${user.id}" data-action="recover" title="Generate recovery code" aria-label="Recovery code for ${escapeHtml(user.name)}" ${user.status !== "Active" ? "disabled" : ""}><i class="bi bi-key" aria-hidden="true"></i></button>
    <button class="manage-user-btn delete-user-btn" type="button" data-user="${user.id}" data-action="delete" title="Delete user" aria-label="Delete ${escapeHtml(user.name)}" ${user.id === KopiApi.getSession()?.user?.id ? "disabled" : ""}><i class="bi bi-trash3" aria-hidden="true"></i></button></div></td></tr>`;
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
const dialog = document.getElementById("userDialog"),
  form = document.getElementById("userForm");
function openUser(action, user) {
  mode = action;
  selectedId = user?.id;
  form.reset();
  document.getElementById("saveUser").disabled = false;
  document.getElementById("userResult").textContent = "";
  document.getElementById("userDialogTitle").textContent =
    action === "create"
      ? "Add user"
      : (action === "recover" ? "Recovery code for " : action === "delete" ? "Delete " : "Manage ") + user.name;
  document.getElementById("saveUser").textContent =
    action === "recover" ? "Generate recovery code" : action === "delete" ? "Delete user" : "Save";
  for (const [id, show] of [
    ["createUserFields", action === "create"],
    ["accessUserFields", action !== "recover" && action !== "delete"],
    ["recoveryIdentity", action === "recover"],
    ["deleteUserConfirm", action === "delete"],
  ]) {
    const section = document.getElementById(id);
    section.hidden = !show;
    section
      .querySelectorAll("input,select")
      .forEach((input) => (input.disabled = !show));
  }
  document.getElementById("userStatusLabel").hidden = action === "create" || action === "delete";
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
  if (mode === "delete" && !window.confirm("Permanently delete this user? This cannot be undone.")) return;
  button.disabled = true;
  try {
    if (mode === "recover")
      body.identityConfirmed = form.elements.identityConfirmed.checked;
    if (mode === "delete") body.confirmDelete = form.elements.confirmDelete.checked;
    const endpoint =
      mode === "create"
        ? "/admin/users"
        : "/admin/users/" +
          selectedId +
          (mode === "recover" ? "/recovery-code" : "");
    const data = await KopiApi.request(endpoint, {
      method: mode === "access" ? "PATCH" : mode === "delete" ? "DELETE" : "POST",
      body: JSON.stringify(body),
    });
    form.elements.currentPassword.value = "";
    form.elements.password.value = "";
    result.textContent = data.message;
    if (mode === "recover") {
      const code = document.createElement("strong");
      code.className = "recovery-code";
      code.textContent = data.code;
      result.prepend(code);
      return;
    }
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
