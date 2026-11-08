const adminProfile=document.querySelector(".admin-profile");
let adminLogoutPending = false;

async function logoutAdmin(button) {
  if (adminLogoutPending) return;
  adminLogoutPending = true;
  button.disabled = true;
  let delay = 1200;
  try {
    await KopiApi.logout();
    KopiNotice.toast("Successfully Logged out", "success");
  } catch {
    delay = 3500;
    KopiNotice.toast("Signed out locally. Other sessions could not be revoked while the server is unreachable.", "warning");
  }
  await new Promise(resolve => setTimeout(resolve, delay));
  window.location.href = "../login.html";
}

if(adminProfile) {
  adminProfile.setAttribute("aria-expanded","false");
  let user,menu;
  const photoSignal = "kopi_admin_profile_changed";
  const headerAvatar = document.createElement("span");
  headerAvatar.className = "admin-header-avatar";
  headerAvatar.setAttribute("aria-hidden","true");
  adminProfile.querySelector(":scope > .bi-person-circle")?.replaceWith(headerAvatar);
  const close=()=>{
    if(!menu)return;
    const closing=menu;menu=null;adminProfile.setAttribute("aria-expanded","false");
    // Let the menu fade out before it leaves the page.
    if(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches){closing.remove();return;}
    closing.classList.add("is-closing");
    setTimeout(()=>closing.remove(),180);
  };
  const refreshHeader=()=>{
    const name=adminProfile.querySelector(".profile-text strong");
    if(name)name.textContent=user.firstName;
    KopiProfile.avatar(headerAvatar,user.avatar);
  };
  const refreshProfile=()=>KopiApi.request("/me").then(data=>{user=data.user;refreshHeader();}).catch(()=>{});
  refreshProfile();
  window.addEventListener("storage",event=>{if(event.key===photoSignal)refreshProfile();});
  window.addEventListener("focus",refreshProfile);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshProfile();});
  // Same small account menu as the Staff and Cashier pages; profile changes live in Settings.
  adminProfile.addEventListener("click",async event=>{
    event.preventDefault();
    if(menu){close();return;}
    try {
      user=(await KopiApi.request("/me")).user;
      refreshHeader();
      menu=document.createElement("section");menu.className="admin-profile-menu";
      menu.setAttribute("aria-label","Administrator account");
      menu.innerHTML=`<strong data-name></strong><small data-email></small>
        <button class="menu-logout" type="button"><i class="bi bi-box-arrow-right" aria-hidden="true"></i> Log out</button>`;
      menu.querySelector("[data-name]").textContent=[user.firstName,user.lastName].filter(Boolean).join(" ");
      menu.querySelector("[data-email]").textContent=user.email;
      document.body.appendChild(menu);adminProfile.setAttribute("aria-expanded","true");
      const rect=adminProfile.getBoundingClientRect();
      menu.style.top=Math.max(8,rect.bottom+8)+"px";
      menu.style.right=Math.max(12,window.innerWidth-rect.right)+"px";
      menu.querySelector(".menu-logout").addEventListener("click", event => logoutAdmin(event.currentTarget));
      menu.querySelector(".menu-logout").focus();
    }catch(error){KopiNotice.toast(error.message, "error");}
  });
  document.addEventListener("click",event=>{if(menu&&!menu.contains(event.target)&&!adminProfile.contains(event.target))close();});
  document.addEventListener("keydown",event=>{if(event.key==="Escape"){close();adminProfile.focus();}});
}
