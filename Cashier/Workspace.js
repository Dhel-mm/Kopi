/* Shared employee shell; server-side permissions remain the authority. */
window.KopiWorkplace = (() => {
  "use strict";
  const role = document.body.dataset.workspace;
  const page = document.body.dataset.page;
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money = value => new Intl.NumberFormat("en-PH", {style:"currency",currency:"PHP"}).format(Number(value) || 0);
  const date = value => new Intl.DateTimeFormat("en-PH", {dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Manila"})
    .format(new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(" ","T") + "Z"));
  const links = role === "Cashier"
    ? [["Orders.html","Orders","bi-cup-hot-fill","orders"],["Verify.html","Verify payments","bi-patch-check-fill","verify"],["History.html","Order history","bi-receipt","history"],["Inventory.html","Inventory","bi-box-seam","stock"],["Settings.html","Settings","bi-gear-fill","settings"]]
    : [["Orders.html","Preparation","bi-cup-hot-fill","queue"],["Inventory.html","Stock availability","bi-box-seam","stock"],["Settings.html","Settings","bi-gear-fill","settings"]];
  const sidebar = document.getElementById("workspaceSidebar");
  sidebar.innerHTML = `<div class="admin-brand workspace-brand"><img src="../Customer/HomePic/Logo.png" alt="Kopi logo"><span>Kopi;</span></div>
    <p class="workspace-label">${role.toUpperCase()} WORKSPACE</p>
    <nav class="admin-nav" aria-label="${role} navigation">${links.map(([url,label,icon,id]) =>
      `<a class="admin-nav-link ${page===id?"active":""}" href="${url}" ${page===id?'aria-current="page"':""}><i class="bi ${icon}" aria-hidden="true"></i><span>${label}</span></a>`).join("")}</nav>
    <p class="workspace-sidebar-note">Not just coffee,<br>it’s happiness.</p>`;
  const header = document.getElementById("workspaceHeader");
  header.innerHTML = `<div class="topbar-text"><h1>${escape(document.body.dataset.title)}</h1><p>${escape(document.body.dataset.subtitle)}</p></div>
    <button type="button" class="admin-profile workspace-profile" aria-label="Open account menu" aria-expanded="false" aria-controls="workspaceMenu">
      <i class="bi bi-person-circle" data-avatar aria-hidden="true"></i><div class="profile-text"><strong data-worker-name>${role}</strong><span>${role}</span></div>
      <i class="bi bi-chevron-down" aria-hidden="true"></i></button>
    <div id="workspaceMenu" class="workspace-menu" hidden><strong data-worker-name></strong><small data-worker-email></small><button class="workspace-btn" type="button" id="workspaceLogout"><i class="bi bi-box-arrow-right" aria-hidden="true"></i> Log out</button></div>`;
  const profile = header.querySelector(".workspace-profile");
  const menu = document.getElementById("workspaceMenu");
  function closeMenu() {menu.hidden=true;profile.setAttribute("aria-expanded","false");}
  profile.addEventListener("click", () => {menu.hidden=!menu.hidden;profile.setAttribute("aria-expanded",String(!menu.hidden));});
  document.addEventListener("click", event => {if (!profile.contains(event.target) && !menu.contains(event.target)) closeMenu();});
  document.addEventListener("keydown", event => {if (event.key==="Escape"&&!menu.hidden) {closeMenu();profile.focus();}});
  document.getElementById("workspaceLogout").addEventListener("click", async event => {
    event.currentTarget.disabled=true;
    try {await KopiApi.logout();KopiNotice.toast("Successfully Logged out","success");}
    catch {KopiNotice.toast("Signed out locally. The server could not revoke other sessions.","warning");}
    setTimeout(() => window.location.replace("../login.html"), 1200);
  });
  const ready = (async () => {
    if (!KopiApi.getSession()?.token) {
      if (window.KopiNotice?.loginRequired?.({staff:true})) document.getElementById("workspaceGate").hidden = true;
      else window.location.replace("../login.html");
      return null;
    }
    try {
      const {user} = await KopiApi.request("/me");
      if (![role,"Admin"].includes(user.role)) {window.location.replace(KopiApi.homeForRole(user.role));return null;}
      if (user.mustChangePassword) {window.location.replace("/change-password.html");return null;}
      header.querySelectorAll("[data-worker-name]").forEach(node => {node.textContent=[user.firstName,user.lastName].filter(Boolean).join(" ");});
      header.querySelector("[data-worker-email]").textContent=user.email;
      if (user.avatar) {
        const img = document.createElement("img");img.className="workspace-avatar";img.alt="Your profile photo";img.src=user.avatar;
        header.querySelector("[data-avatar]").replaceWith(img);
      }
      document.body.classList.remove("workspace-loading");
      document.getElementById("workspaceGate").hidden=true;
      return user;
    } catch (error) {
      if (error.status===401) {window.location.replace("../login.html");return null;}
      document.getElementById("workspaceGate").innerHTML=`<h1>Unable to open your workspace</h1><p>${escape(error.message)}</p><button class="workspace-btn" id="retryWorkspace">Try again</button>`;
      document.getElementById("retryWorkspace").addEventListener("click",()=>window.location.reload());
      return null;
    }
  })();
  return {ready,escape,money,date};
})();
