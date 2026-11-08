// Email verification for new customer accounts. Isolated test databases and a
// fake mailer only: no real email is sent.
const {test}=require("node:test");
const assert=require("node:assert/strict");
const bcrypt=require("bcryptjs");
const {fixture}=require("./fixtures");
const {createApp}=require("../app");
const {createMailer}=require("../services/mailer");
const {createEmailVerification}=require("../services/emailVerification");
process.env.JWT_SECRET="email-verification-test-only-secret-at-least-32";

const PASSWORD="ValidTestPassword!";
async function harness(run,settings={}) {
  const db=fixture();
  const sent=[];
  let failing=false;
  const mailer={configured:true,send:async message=>{if(failing)throw Object.assign(new Error("We could not send the email right now."),{name:"OrderError"});sent.push(message);return {delivered:true};}};
  const app=createApp(db,{origin:"http://localhost:3000",mailer,...settings});
  const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  const request=async(path,body)=>{
    const result=await fetch("http://127.0.0.1:"+server.address().port+"/api"+path,{method:body===undefined?"GET":"POST",
      headers:{"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:result.status,data:await result.json()};
  };
  const lastCode=()=>sent.at(-1).text.match(/\b\d{6}\b/)[0];
  const signup=(email="juan@test.invalid",extra={})=>request("/auth/signup",{firstName:"Juan",lastName:"Cruz",email,password:PASSWORD,...extra});
  try {await run({db,request,sent,lastCode,signup,setFailing:value=>{failing=value;}});}
  finally {await new Promise(resolve=>server.close(resolve));db.close();}
}

test("a new customer must enter the emailed code before logging in; the code signs them in",()=>harness(async({db,request,sent,lastCode,signup})=>{
  const created=await signup("Juan@Test.invalid");
  assert.equal(created.status,201);
  assert.equal(created.data.verificationRequired,true);
  assert.equal(created.data.token,undefined,"no session before the email is verified");
  assert.equal(created.data.email,"juan@test.invalid");
  assert.equal(created.data.maskedEmail,"ju**@test.invalid");
  assert.equal(sent.length,1);
  assert.equal(sent[0].to,"juan@test.invalid");
  assert.match(sent[0].subject,/verification code/);
  // The code is stored only as a hash.
  const row=db.prepare("SELECT * FROM email_verifications").get();
  assert.ok(!JSON.stringify(row).includes(lastCode()));

  const login=await request("/auth/login",{email:"juan@test.invalid",password:PASSWORD});
  assert.equal(login.status,403);
  assert.equal(login.data.verificationRequired,true);
  assert.equal(login.data.token,undefined);
  assert.equal(sent.length,1,"logging in again within a minute does not send another email");
  // A wrong password does not reveal that the account is unverified.
  assert.equal((await request("/auth/login",{email:"juan@test.invalid",password:"WrongPassword123!"})).status,401);

  const wrong=lastCode()==="000000"?"111111":"000000";
  const bad=await request("/auth/verify-email",{email:"juan@test.invalid",code:wrong});
  assert.equal(bad.status,400);
  assert.match(bad.data.message,/incorrect. 4 tries left/);

  const ok=await request("/auth/verify-email",{email:"juan@test.invalid",code:lastCode()});
  assert.equal(ok.status,200);
  assert.ok(ok.data.token);
  assert.equal(ok.data.user.role,"Customer");
  assert.ok(db.prepare("SELECT email_verified_at FROM users WHERE email='juan@test.invalid'").get().email_verified_at);
  assert.equal((await request("/auth/login",{email:"juan@test.invalid",password:PASSWORD})).status,200);
  // Verifying again is harmless.
  assert.equal((await request("/auth/verify-email",{email:"juan@test.invalid",code:"123456"})).data.alreadyVerified,true);
}));

test("existing accounts and accounts created by the administrator are not blocked",()=>harness(async({db,request})=>{
  db.prepare("UPDATE users SET password_hash=? WHERE id=1").run(bcrypt.hashSync(PASSWORD,4));
  assert.equal((await request("/auth/login",{email:"customer@test.invalid",password:PASSWORD})).status,200);
}));

test("codes expire, wrong guesses are limited, and resending has a wait and an hourly limit",()=>harness(async({db,request,sent,lastCode,signup})=>{
  await signup();
  const resendTooSoon=await request("/auth/resend-verification",{email:"juan@test.invalid"});
  assert.equal(resendTooSoon.status,429);
  assert.ok(resendTooSoon.data.waitSeconds>0);
  // Five wrong codes lock the current code.
  for (let i=0;i<5;i++) await request("/auth/verify-email",{email:"juan@test.invalid",code:lastCode()==="999999"?"888888":"999999"});
  const locked=await request("/auth/verify-email",{email:"juan@test.invalid",code:lastCode()});
  assert.equal(locked.status,429);
  // After the wait, a new code is sent and works.
  db.prepare("UPDATE email_verifications SET sent_at=sent_at-61000").run();
  const resent=await request("/auth/resend-verification",{email:"juan@test.invalid"});
  assert.equal(resent.status,200);
  assert.equal(sent.length,2);
  // An expired code is refused.
  db.prepare("UPDATE email_verifications SET expires_at=?").run(Date.now()-1);
  assert.equal((await request("/auth/verify-email",{email:"juan@test.invalid",code:lastCode()})).status,410);
  // Hourly limit: 5 emails per account.
  for (let i=0;i<3;i++) {db.prepare("UPDATE email_verifications SET sent_at=sent_at-61000").run();await request("/auth/resend-verification",{email:"juan@test.invalid"});}
  assert.equal(sent.length,5);
  db.prepare("UPDATE email_verifications SET sent_at=sent_at-61000").run();
  assert.equal((await request("/auth/resend-verification",{email:"juan@test.invalid"})).status,429);
  assert.equal(sent.length,5);
  // Unknown emails get the same neutral answer.
  const unknown=await request("/auth/resend-verification",{email:"nobody@test.invalid"});
  assert.equal(unknown.status,200);
  assert.match(unknown.data.message,/If that email/);
}));

test("an unverified signup can be redone, but a verified email cannot be taken",()=>harness(async({request,sent,lastCode,signup})=>{
  await signup("maria@test.invalid",{firstName:"Someone"});
  const again=await signup("maria@test.invalid",{firstName:"Maria",password:"AnotherValidPassword!"});
  assert.equal(again.status,201);
  assert.equal(again.data.verificationRequired,true);
  const ok=await request("/auth/verify-email",{email:"maria@test.invalid",code:lastCode()});
  assert.equal(ok.data.user.firstName,"Maria");
  assert.equal((await request("/auth/login",{email:"maria@test.invalid",password:"AnotherValidPassword!"})).status,200);
  assert.equal((await signup("maria@test.invalid")).status,409);
  assert.equal(sent.length,1);
}));

test("if the email cannot be sent, the account is kept and the code can be resent at once",()=>harness(async({request,sent,signup,setFailing})=>{
  setFailing(true);
  const created=await signup();
  assert.equal(created.status,201);
  assert.equal(created.data.codeSent,false);
  assert.ok(created.data.sendProblem);
  setFailing(false);
  assert.equal((await request("/auth/resend-verification",{email:"juan@test.invalid"})).status,200);
  assert.equal(sent.length,1);
}));

test("production without email settings turns verification off instead of blocking sign-ups",()=>harness(async({request,signup})=>{
  const created=await signup();
  assert.equal(created.status,201);
  assert.ok(created.data.token);
  assert.equal((await request("/auth/login",{email:"juan@test.invalid",password:PASSWORD})).status,200);
},{production:true,mailer:createMailer({NODE_ENV:"production"})}));

test("the mailer posts to Brevo with the sender and prints codes only in development",async()=>{
  const calls=[];
  const brevo=createMailer({BREVO_API_KEY:"key-123",MAIL_FROM:"shop@test.invalid",MAIL_FROM_NAME:"Kopi"},
    {fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,status:201};}});
  assert.equal(brevo.configured,true);
  await brevo.send({to:"a@test.invalid",subject:"S",text:"T",html:"<p>T</p>"});
  assert.equal(calls[0].url,"https://api.brevo.com/v3/smtp/email");
  assert.equal(calls[0].options.headers["api-key"],"key-123");
  assert.deepEqual(JSON.parse(calls[0].options.body).sender,{name:"Kopi",email:"shop@test.invalid"});
  const failing=createMailer({BREVO_API_KEY:"k",MAIL_FROM:"f@test.invalid"},{fetchImpl:async()=>({ok:false,status:401}),log:{error(){}}});
  await assert.rejects(failing.send({to:"a@test.invalid",subject:"S",text:"T"}),/could not send/);
  const printed=[];
  const dev=createMailer({},{log:{log:text=>printed.push(text)}});
  assert.equal((await dev.send({to:"a@test.invalid",subject:"S",text:"code 123456"})).logged,true);
  assert.match(printed[0],/123456/);
  await assert.rejects(createMailer({NODE_ENV:"production"}).send({to:"a@test.invalid",subject:"S",text:"T"}),/not set up/);
});

test("verification codes are 6 digits and the email masks the address",()=>{
  const db=fixture();
  try {
    const messages=[];
    const service=createEmailVerification(db,{send:async m=>{messages.push(m);}});
    assert.equal(service.maskEmail("ab@x.com"),"a*@x.com");
    assert.equal(service.maskEmail("margarita@x.com"),"ma******@x.com");
    return service.sendCode(db.prepare("SELECT * FROM users WHERE id=1").get()).then(result=>{
      assert.equal(result.sent,true);
      assert.match(messages[0].text,/\b\d{6}\b/);
      assert.match(messages[0].html,/Verify your email/);
    });
  } finally {setTimeout(()=>db.close(),50);}
});

test("Gmail-style SMTP: logs in, sends a readable message, and reports a refused login",async()=>{
  const net=require("node:net");
  const {smtpSend}=require("../services/mailer");
  const sessions=[];
  const server=net.createServer(socket=>{
    const session={lines:[],data:""};sessions.push(session);
    let inData=false,buffer="";
    socket.write("220 fake.smtp ready\r\n");
    socket.on("data",chunk=>{
      buffer+=chunk.toString();
      let index;
      while ((index=buffer.indexOf("\r\n"))>=0) {
        const line=buffer.slice(0,index);buffer=buffer.slice(index+2);
        if (inData) {
          if (line===".") {inData=false;socket.write("250 queued\r\n");}
          else session.data+=line+"\n";
          continue;
        }
        session.lines.push(line);
        if (line.startsWith("EHLO")) socket.write("250-fake.smtp\r\n250-AUTH LOGIN PLAIN\r\n250 OK\r\n");
        else if (line==="AUTH LOGIN") socket.write("334 VXNlcm5hbWU6\r\n");
        else if (session.lines.length===3) socket.write("334 UGFzc3dvcmQ6\r\n");
        else if (session.lines.length===4) socket.write(Buffer.from(line,"base64").toString()==="right-pass"?"235 ok\r\n":"535 bad credentials\r\n");
        else if (line.startsWith("MAIL FROM")||line.startsWith("RCPT TO")) socket.write("250 ok\r\n");
        else if (line==="DATA") {inData=true;socket.write("354 go ahead\r\n");}
        else if (line==="QUIT") socket.end("221 bye\r\n");
      }
    });
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const port=server.address().port;
  const base={host:"127.0.0.1",port,secure:false,user:"shop@gmail.test",from:"shop@gmail.test",fromName:"Kopi; Calamba",
    to:"juan@test.invalid",subject:"Your code: 123456",text:"Your code is 123456",html:"<b>123456</b>"};
  try {
    await smtpSend({...base,pass:"right-pass"});
    const sent=sessions[0];
    assert.equal(Buffer.from(sent.lines[2],"base64").toString(),"shop@gmail.test");
    assert.ok(sent.lines.includes("RCPT TO:<juan@test.invalid>"));
    assert.match(sent.data,/Content-Type: multipart\/alternative/);
    const textPart=sent.data.split("Content-Transfer-Encoding: base64\n\n")[1].split("\n--")[0].replace(/\n/g,"");
    assert.equal(Buffer.from(textPart,"base64").toString(),"Your code is 123456");
    await assert.rejects(smtpSend({...base,pass:"wrong"}),error=>error.code==="535");
    // Through the mailer, Gmail is chosen when SMTP_USER and SMTP_PASS are set (spaces in the app password are ignored).
    const errors=[];
    const mailer=createMailer({SMTP_USER:"shop@gmail.test",SMTP_PASS:"wron g",SMTP_HOST:"127.0.0.1",SMTP_PORT:String(port),SMTP_SECURE:"false"},{log:{error:(...a)=>errors.push(a.join(" "))}});
    assert.equal(mailer.method,"smtp");
    await assert.rejects(mailer.send({to:"juan@test.invalid",subject:"S",text:"T"}),/could not send/);
    assert.match(errors[0],/App password/);
    const good=createMailer({SMTP_USER:"shop@gmail.test",SMTP_PASS:"right-pass",SMTP_HOST:"127.0.0.1",SMTP_PORT:String(port),SMTP_SECURE:"false"});
    assert.equal((await good.send({to:"juan@test.invalid",subject:"S",text:"T"})).delivered,true);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
