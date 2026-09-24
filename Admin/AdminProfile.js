const adminProfile=document.querySelector(".admin-profile");
if(adminProfile) {
  let user,menu;
  const close=()=>{menu?.remove();menu=null;adminProfile.setAttribute("aria-expanded","false");};
  const refreshHeader=()=>{
    const name=adminProfile.querySelector(".profile-text strong");
    if(name)name.textContent=user.firstName;
  };
  KopiApi.request("/me").then(data=>{user=data.user;refreshHeader();}).catch(()=>{});
  adminProfile.addEventListener("click",async event=>{
    event.preventDefault();
    if(menu){close();return;}
    try {
      user=(await KopiApi.request("/me")).user;
      menu=document.createElement("section");menu.className="admin-profile-menu";
      menu.setAttribute("aria-label","Administrator account");
      menu.innerHTML=`<div class="admin-profile-menu-head"><div class="menu-avatar"></div><div><strong data-name></strong><span>Administrator</span></div></div>
        <input type="file" accept="image/png,image/jpeg" hidden>
        <button class="change-photo" type="button">Change Photo</button>
        <button class="remove-photo" type="button">Remove Photo</button>
        <details><summary>Profile details & password</summary><form>
          <label>First name<input name="firstName" required maxlength="100"></label>
          <label>Last name<input name="lastName" required maxlength="100"></label>
          <label>Email<input name="email" type="email" required maxlength="254"></label>
          <label>Phone<input name="phone" type="tel" pattern="09[0-9]{9}" maxlength="11"></label>
          <label>Current password<input name="currentPassword" type="password" autocomplete="current-password"></label>
          <label>New password<input name="newPassword" type="password" minlength="12" maxlength="72" autocomplete="new-password"></label>
          <label>Confirm password<input name="confirmPassword" type="password" autocomplete="new-password"></label>
          <small>Current password is required for an email or password change. New passwords need 12 characters.</small>
          <button type="submit">Save changes</button>
        </form></details><p role="status"></p><button class="menu-logout" type="button">Logout</button>`;
      document.body.appendChild(menu);adminProfile.setAttribute("aria-expanded","true");
      const currentMenu=menu,form=menu.querySelector("form"),status=menu.querySelector('[role="status"]');
      menu.querySelector("[data-name]").textContent=user.firstName+" "+user.lastName;
      for(const key of ["firstName","lastName","email","phone"])form.elements[key].value=user[key]||"";
      const avatar=menu.querySelector(".menu-avatar");KopiProfile.avatar(avatar,user.avatar);
      const rect=adminProfile.getBoundingClientRect();
      menu.style.top=Math.max(8,rect.bottom+8)+"px";
      menu.style.right=Math.max(12,window.innerWidth-rect.right)+"px";
      const input=menu.querySelector('[type="file"]');
      menu.querySelector(".change-photo").addEventListener("click",()=>input.click());
      input.addEventListener("change",async()=>{
        if(!input.files.length)return;
        try {const result=await KopiProfile.upload(input.files[0]);KopiProfile.avatar(avatar,result.avatar);status.textContent=result.message;}
        catch(error){status.textContent=error.message;}
        finally{input.value="";}
      });
      menu.querySelector(".remove-photo").addEventListener("click",async()=>{
        try {await KopiApi.request("/me/avatar",{method:"DELETE"});KopiProfile.avatar(avatar,null);status.textContent="Profile photo removed.";}
        catch(error){status.textContent=error.message;}
      });
      form.addEventListener("submit",async event=>{
        event.preventDefault();const button=form.querySelector('[type="submit"]');button.disabled=true;
        try {const result=await KopiProfile.save(form);user=result.user;refreshHeader();currentMenu.querySelector("[data-name]").textContent=user.firstName+" "+user.lastName;status.textContent=result.message;}
        catch(error){status.textContent=error.message;}finally{button.disabled=false;}
      });
      menu.querySelector(".menu-logout").addEventListener("click",async()=>{
        try{await KopiApi.logout();}catch{alert("Signed out locally. Other sessions could not be revoked while the server is unreachable.");}
        localStorage.removeItem("kopi_session");window.location.href="../login.html";
      });
    }catch(error){alert(error.message);}
  });
  document.addEventListener("click",event=>{if(menu&&!menu.contains(event.target)&&!adminProfile.contains(event.target))close();});
  document.addEventListener("keydown",event=>{if(event.key==="Escape"){close();adminProfile.focus();}});
}
