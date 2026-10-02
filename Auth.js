document.querySelectorAll("[data-toggle-password]").forEach(button=>{
  const toggle=()=>{
    const input=document.getElementById(button.dataset.togglePassword);
    input.type=input.type==="password"?"text":"password";
    button.querySelector("i")?.classList.toggle("bi-eye",input.type==="text");
    button.querySelector("i")?.classList.toggle("bi-eye-slash",input.type==="password");
  };
  button.addEventListener("click",toggle);
  button.addEventListener("keydown",event=>{if(["Enter"," "].includes(event.key)){event.preventDefault();toggle();}});
});
const authForm=document.querySelector("#loginForm, #signupForm, #resetForm");
authForm?.addEventListener("submit",async event=>{
  event.preventDefault();
  const submit=authForm.querySelector('[type="submit"]');
  if (submit.disabled) return;
  const status=document.getElementById("authStatus");
  const values=Object.fromEntries(new FormData(authForm));
  if(values.confirmPassword!==undefined && values.password!==values.confirmPassword) {
    KopiNotice.set(status,"Passwords do not match.","error");return;
  }
  submit.disabled=true;KopiNotice.set(status,"Please wait…","loading");
  try {
    if(authForm.id==="loginForm") {
      const remember=document.getElementById("rememberMe").checked;
      const data=await KopiApi.request("/auth/login",{method:"POST",body:JSON.stringify({...values,remember})});
      KopiApi.saveSession(data,remember);localStorage.removeItem("kopi_session");
      KopiNotice.set(status,"Successfully logged in. Redirecting…","success");
      KopiNotice.toast("Successfully logged in","success",2500);
      await new Promise(resolve=>setTimeout(resolve,1500));
      window.location.href=data.user.role==="Admin"?"Admin/Dashboard.html":"Customer/Homepage.html";
    } else if(authForm.id==="signupForm") {
      await KopiApi.request("/auth/signup",{method:"POST",body:JSON.stringify(values)});
      KopiNotice.set(status,"Account created. Redirecting to login…","success");
      await new Promise(resolve=>setTimeout(resolve,1200));
      window.location.href="login.html";
    } else {
      const data=await KopiApi.request("/auth/reset-password",{method:"POST",body:JSON.stringify({code:values.code,newPassword:values.password})});
      KopiApi.clearSession();authForm.reset();KopiNotice.set(status,data.message,"success");
    }
  } catch(error) {KopiNotice.set(status,error.message,"error");}
  finally {submit.disabled=false;}
});
