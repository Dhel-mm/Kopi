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
// Remembers which email is waiting for its verification code (this tab only).
const VERIFY_KEY="kopi_verify";
function goVerify(data) {
  try {sessionStorage.setItem(VERIFY_KEY,JSON.stringify({email:data.email,maskedEmail:data.maskedEmail,
    waitSeconds:data.waitSeconds||0,sendProblem:data.sendProblem||"",at:Date.now()}));} catch {}
  window.location.href="verify.html";
}
// First, middle and last names cannot contain numbers.
document.querySelectorAll('#signupForm [name="firstName"], #signupForm [name="lastName"], #signupForm [name="middleName"]').forEach(input=>{
  input.addEventListener("input",()=>{
    const clean=input.value.replace(/\p{N}/gu,"");
    if(clean!==input.value)input.value=clean;
  });
});
const authForm=document.querySelector("#loginForm, #signupForm, #resetForm, #changePasswordForm");
if(authForm?.id==="changePasswordForm"&&!KopiApi.getSession()?.token)window.location.replace("login.html");
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
      let data;
      try {data=await KopiApi.request("/auth/login",{method:"POST",body:JSON.stringify({...values,remember})});}
      catch(error) {
        if (error.status===403&&error.data?.verificationRequired) {
          KopiNotice.set(status,error.message,"error");
          await new Promise(resolve=>setTimeout(resolve,1400));
          return goVerify(error.data);
        }
        throw error;
      }
      KopiApi.saveSession(data,remember);localStorage.removeItem("kopi_session");
      KopiNotice.set(status,"Successfully logged in. Redirecting…","success");
      KopiNotice.toast("Successfully logged in","success",2500);
      await new Promise(resolve=>setTimeout(resolve,1500));
      // A temporary password must be replaced before anything else.
      window.location.href=data.user.mustChangePassword?"change-password.html":KopiApi.homeForRole(data.user.role);
    } else if(authForm.id==="changePasswordForm") {
      const data=await KopiApi.request("/me/password",{method:"PATCH",body:JSON.stringify({currentPassword:values.currentPassword,newPassword:values.password})});
      KopiApi.saveSession({user:data.user,token:data.token});
      KopiNotice.set(status,"Password saved. Opening your workspace…","success");
      await new Promise(resolve=>setTimeout(resolve,1200));
      window.location.href=KopiApi.homeForRole(data.user.role);
    } else if(authForm.id==="signupForm") {
      const data=await KopiApi.request("/auth/signup",{method:"POST",body:JSON.stringify(values)});
      if (data.verificationRequired) {
        KopiNotice.set(status,"Account created. Check your email for the verification code…","success");
        await new Promise(resolve=>setTimeout(resolve,1200));
        return goVerify(data);
      }
      KopiNotice.set(status,"Account created. Redirecting to login…","success");
      await new Promise(resolve=>setTimeout(resolve,1200));
      window.location.href="login.html";
    } else {
      // A 6-digit code from the email goes with the email typed above it.
      const code=String(values.code||"").replace(/\s+/g,"");
      const email=document.getElementById("recoveryEmail")?.value?.trim()||"";
      if(/^\d{6}$/.test(code)&&!email) {
        KopiNotice.set(status,"Enter the email of your account above (the one the code was sent to).","error");
        document.getElementById("recoveryEmail")?.focus();
        return;
      }
      const data=await KopiApi.request("/auth/reset-password",{method:"POST",body:JSON.stringify({code,newPassword:values.password,...(email?{email}:{})})});
      KopiApi.clearSession();authForm.reset();KopiNotice.set(status,data.message,"success");
    }
  } catch(error) {KopiNotice.set(status,error.message,"error");}
  finally {submit.disabled=false;}
});

// ---- Recover your account: email a recovery code to an existing account.
const recoveryEmailForm=document.body?.classList?.contains("recovery-page")?document.getElementById("recoveryEmailForm"):null;
if (recoveryEmailForm) {
  const send=recoveryEmailForm.querySelector('[type="submit"]');
  const status=document.getElementById("recoveryEmailStatus");
  let timer=null;
  function waitThenAllow(seconds) {
    clearInterval(timer);
    let left=Math.max(0,Math.round(seconds));
    const draw=()=>{send.disabled=left>0;send.textContent=left>0?`Send again in ${left}s`:"Send recovery code";};
    draw();
    if (left>0) timer=setInterval(()=>{left--;draw();if(left<=0)clearInterval(timer);},1000);
  }
  recoveryEmailForm.addEventListener("submit",async event=>{
    event.preventDefault();
    if (send.disabled) return;
    const email=recoveryEmailForm.elements.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return KopiNotice.set(status,"Enter the email of your account.","error");
    send.disabled=true;KopiNotice.set(status,"Sending your recovery code…","loading");
    try {
      const data=await KopiApi.request("/auth/forgot-password",{method:"POST",body:JSON.stringify({email})});
      KopiNotice.set(status,data.message,"success");
      waitThenAllow(data.waitSeconds||60);
      document.getElementById("recoveryCode")?.focus();
    } catch(error) {
      KopiNotice.set(status,error.message,"error");
      waitThenAllow(error.data?.waitSeconds||0);
    }
  });
}

// ---- Verify email page: 6-digit code, resend with a countdown.
const verifyForm=document.body?.classList?.contains("verify-page")?document.getElementById("verifyForm"):null;
if (verifyForm) {
  let saved={};
  try {saved=JSON.parse(sessionStorage.getItem(VERIFY_KEY)||"{}")||{};} catch {}
  const fromLink=new URLSearchParams(location.search).get("email");
  const emailInput=document.getElementById("verifyEmail");
  const codeInput=document.getElementById("verifyCode");
  const status=document.getElementById("authStatus");
  const resend=document.getElementById("resendCode");
  const label=document.getElementById("verifyEmailLabel");
  const email=()=>(saved.email||emailInput.value||"").trim();
  if (saved.email||fromLink) {
    if (!saved.email) saved.email=fromLink;
    label.textContent=saved.maskedEmail||saved.email;
  } else {
    // Opened directly: ask for the email first.
    document.getElementById("verifyEmailGroup").hidden=false;
    document.getElementById("verifyIntro").textContent="Enter the email you signed up with and the 6-digit code we sent to it.";
  }
  let timer=null;
  function countdown(seconds) {
    clearInterval(timer);
    let left=Math.max(0,Math.round(seconds));
    const draw=()=>{
      resend.disabled=left>0;
      resend.textContent=left>0?`Resend code in ${left}s`:"Resend code";
    };
    draw();
    if (left>0) timer=setInterval(()=>{left--;draw();if(left<=0)clearInterval(timer);},1000);
  }
  const elapsed=saved.at?Math.floor((Date.now()-saved.at)/1000):0;
  countdown((saved.waitSeconds||0)-elapsed);
  if (saved.sendProblem) KopiNotice.set(status,saved.sendProblem+" Tap “Resend code” to try again.","error");
  codeInput.addEventListener("input",()=>{codeInput.value=codeInput.value.replace(/\D/g,"").slice(0,6);});
  verifyForm.addEventListener("submit",async event=>{
    event.preventDefault();
    const submit=verifyForm.querySelector('[type="submit"]');
    if (submit.disabled) return;
    if (!email()) return KopiNotice.set(status,"Enter the email you signed up with.","error");
    if (!/^\d{6}$/.test(codeInput.value)) return KopiNotice.set(status,"Enter the 6-digit code from your email.","error");
    submit.disabled=true;KopiNotice.set(status,"Checking your code…","loading");
    try {
      const data=await KopiApi.request("/auth/verify-email",{method:"POST",body:JSON.stringify({email:email(),code:codeInput.value})});
      try {sessionStorage.removeItem(VERIFY_KEY);} catch {}
      if (data.alreadyVerified) {
        KopiNotice.set(status,data.message,"success");
        await new Promise(resolve=>setTimeout(resolve,1400));
        return void (window.location.href="login.html");
      }
      KopiApi.saveSession(data,false);localStorage.removeItem("kopi_session");
      KopiNotice.set(status,"Email verified! Signing you in…","success");
      KopiNotice.toast("Email verified","success",2500);
      await new Promise(resolve=>setTimeout(resolve,1400));
      window.location.href=KopiApi.homeForRole(data.user.role);
    } catch(error) {KopiNotice.set(status,error.message,"error");codeInput.select();}
    finally {submit.disabled=false;}
  });
  resend.addEventListener("click",async()=>{
    if (resend.disabled) return;
    if (!email()) return KopiNotice.set(status,"Enter the email you signed up with.","error");
    resend.disabled=true;KopiNotice.set(status,"Sending a new code…","loading");
    try {
      const data=await KopiApi.request("/auth/resend-verification",{method:"POST",body:JSON.stringify({email:email()})});
      KopiNotice.set(status,data.message,"success");
      countdown(data.waitSeconds||60);
    } catch(error) {
      KopiNotice.set(status,error.message,"error");
      countdown(error.data?.waitSeconds||0);
    }
  });
}
