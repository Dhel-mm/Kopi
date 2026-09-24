(() => {
  const session=KopiApi.getSession();
  if(!session?.token){window.location.replace("../login.html");return;}
  if(session.user?.role!=="Admin"){window.location.replace("../Customer/Homepage.html");return;}
  KopiApi.request("/me").then(({user})=>{
    if(user.role!=="Admin")window.location.replace("../Customer/Homepage.html");
  }).catch(error=>{
    if(error.status===401||error.status===403){KopiApi.clearSession();window.location.replace("../login.html");}
    else {
      const message=document.createElement("p");message.className="report-status";message.setAttribute("role","alert");
      message.textContent="Cannot reach the backend. Your saved session has been kept. "+error.message;
      document.querySelector(".admin-content")?.prepend(message);
    }
  });
})();
