const rowsEl=document.getElementById("usersRows"),emptyEl=document.getElementById("usersEmpty");
const escapeHtml=value=>String(value??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
let users=[],page=1,mode="create",selectedId;
const size=20;
function renderUsers() {
  const role=document.getElementById("roleFilter").value,status=document.getElementById("statusFilter").value;
  const search=document.getElementById("userSearch").value.trim().toLowerCase();
  const visible=users.filter(user=>(user.name+" "+user.email).toLowerCase().includes(search)&&(role==="All"||user.role===role)&&(status==="All"||user.status===status));
  const pages=Math.max(1,Math.ceil(visible.length/size));page=Math.min(page,pages);
  document.getElementById("totalUsers").textContent=users.length;
  document.getElementById("activeUsers").textContent=users.filter(user=>user.status==="Active").length;
  document.getElementById("inactiveUsers").textContent=users.filter(user=>user.status==="Inactive").length;
  document.getElementById("adminUsers").textContent=users.filter(user=>user.role==="Admin").length;
  rowsEl.innerHTML=visible.slice((page-1)*size,page*size).map((user,index)=>`<tr><td>${(page-1)*size+index+1}</td><td>${escapeHtml(user.name)}</td>
    <td>${escapeHtml(user.email)}</td><td>${escapeHtml(user.phone||"—")}</td><td>${user.totalOrders}</td><td>₱${Number(user.totalSpent).toFixed(2)}</td>
    <td>${escapeHtml(user.role)}</td><td>${String(user.createdAt).slice(0,10)}</td><td>${escapeHtml(user.status)}
    <button type="button" data-user="${user.id}" data-action="access">Manage</button><button type="button" data-user="${user.id}" data-action="recover">Recovery code</button></td></tr>`).join("");
  emptyEl.hidden=visible.length>0;emptyEl.textContent="No matching users.";
  document.getElementById("usersRange").textContent=visible.length?"Showing "+((page-1)*size+1)+"–"+Math.min(page*size,visible.length)+" of "+visible.length:"Showing 0 users";
  const buttons=document.querySelectorAll(".pagination button");buttons[0].disabled=page===1;buttons[1].textContent=page+" / "+pages;buttons[2].disabled=page===pages;
}
async function refreshUsers() {
  try {users=(await KopiApi.request("/admin/users")).users;renderUsers();}
  catch(error){emptyEl.hidden=false;emptyEl.textContent=error.message;rowsEl.innerHTML="";}
}
for(const id of ["userSearch","roleFilter","statusFilter"])document.getElementById(id).addEventListener(id==="userSearch"?"input":"change",()=>{page=1;renderUsers();});
document.querySelectorAll(".pagination button")[0].addEventListener("click",()=>{page--;renderUsers();});
document.querySelectorAll(".pagination button")[2].addEventListener("click",()=>{page++;renderUsers();});
const dialog=document.getElementById("userDialog"),form=document.getElementById("userForm");
function openUser(action,user) {
  mode=action;selectedId=user?.id;form.reset();document.getElementById("saveUser").disabled=false;
  document.getElementById("userResult").textContent="";
  document.getElementById("userDialogTitle").textContent=action==="create"?"Add user":(action==="recover"?"Recover ":"Manage ")+user.name;
  for(const [id,show] of [["createUserFields",action==="create"],["accessUserFields",action!=="recover"],["recoveryIdentity",action==="recover"]]) {
    const section=document.getElementById(id);section.hidden=!show;
    section.querySelectorAll("input,select").forEach(input=>input.disabled=!show);
  }
  document.getElementById("userStatusLabel").hidden=action==="create";
  form.elements.identityConfirmed.required=action==="recover";
  if(user){form.elements.role.value=user.role;form.elements.status.value=user.status;}
  dialog.showModal();
}
document.getElementById("addUser").addEventListener("click",()=>openUser("create"));
document.getElementById("closeUserDialog").addEventListener("click",()=>dialog.close());
rowsEl.addEventListener("click",event=>{
  const button=event.target.closest("[data-user]");if(!button)return;
  const user=users.find(user=>user.id===Number(button.dataset.user));if(user)openUser(button.dataset.action,user);
});
form.addEventListener("submit",async event=>{
  event.preventDefault();
  const button=document.getElementById("saveUser"),result=document.getElementById("userResult");
  const body=Object.fromEntries(new FormData(form));body.identityConfirmed=form.elements.identityConfirmed.checked;
  const editingOwnAccess=mode==="access"&&selectedId===KopiApi.getSession()?.user?.id;
  button.disabled=true;
  try {
    const endpoint=mode==="create"?"/admin/users":"/admin/users/"+selectedId+(mode==="recover"?"/recovery-code":"");
    const data=await KopiApi.request(endpoint,{method:mode==="access"?"PATCH":"POST",body:JSON.stringify(body)});
    form.elements.currentPassword.value="";form.elements.password.value="";
    result.textContent=data.code?data.message+" Code: "+data.code:data.message;
    if(editingOwnAccess){KopiApi.clearSession();window.location.href="../login.html";return;}
    await refreshUsers();
  }catch(error){result.textContent=error.message;button.disabled=false;}
});
async function refreshFeedback() {
  const target=document.getElementById("adminFeedback");
  try {
    const data=await KopiApi.request("/admin/feedback");
    target.innerHTML=data.feedback.map(row=>`<details><summary>${escapeHtml(row.customer)} — ${row.rating}/5 — ${escapeHtml(row.createdAt)} UTC</summary>
      <p><strong>Improve:</strong> ${escapeHtml(row.improveComment)}</p><p><strong>Liked:</strong> ${escapeHtml(row.likedComment)}</p>
      <p><strong>Visit frequency:</strong> ${escapeHtml(row.visitFrequency)}</p><p>${escapeHtml(row.additionalComment)}</p></details>`).join("")||"<p>No feedback yet.</p>";
  }catch(error){target.textContent=error.message;}
}
window.addEventListener("focus",()=>{refreshUsers();refreshFeedback();});
refreshUsers();refreshFeedback();
