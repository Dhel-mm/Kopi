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
  const status=document.getElementById("authStatus");
  const values=Object.fromEntries(new FormData(authForm));
  if(values.confirmPassword!==undefined && values.password!==values.confirmPassword) {
    status.textContent="Passwords do not match.";return;
  }
  submit.disabled=true;status.textContent="Please wait…";
  try {
    if(authForm.id==="loginForm") {
      const remember=document.getElementById("rememberMe").checked;
      const data=await KopiApi.request("/auth/login",{method:"POST",body:JSON.stringify({...values,remember})});
      KopiApi.saveSession(data,remember);localStorage.removeItem("kopi_session");
      window.location.href=data.user.role==="Admin"?"Admin/Dashboard.html":"Customer/Homepage.html";
    } else if(authForm.id==="signupForm") {
      await KopiApi.request("/auth/signup",{method:"POST",body:JSON.stringify(values)});
      status.textContent="Account created. Redirecting to login…";
      window.location.href="login.html";
    } else {
      const data=await KopiApi.request("/auth/reset-password",{method:"POST",body:JSON.stringify({code:values.code,newPassword:values.password})});
      KopiApi.clearSession();authForm.reset();status.textContent=data.message;
    }
  } catch(error) {status.textContent=error.message;}
  finally {submit.disabled=false;}
});
