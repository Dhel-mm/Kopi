const {test}=require("node:test");
const assert=require("node:assert/strict");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const {fixture}=require("./fixtures");
const {createApp}=require("../app");
const secret="account-integration-test-only-secret-at-least-32";
process.env.JWT_SECRET=secret;
const adminPassword="AdministratorTestPassword!";
const customerPassword="CustomerTestPassword!";
async function harness(run) {
  const db=fixture();
  db.prepare("UPDATE users SET password_hash=? WHERE id=1").run(bcrypt.hashSync(customerPassword,4));
  db.prepare("UPDATE users SET password_hash=? WHERE id=2").run(bcrypt.hashSync(adminPassword,4));
  const sent=[];
  const mailer={configured:true,send:async message=>{sent.push(message);return {delivered:true};}};
  const app=createApp(db,{origin:"http://localhost:3000",mailer});
  const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  const request=async(path,method="GET",body,token)=>{
    const result=await fetch("http://127.0.0.1:"+server.address().port+path,{method,headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:result.status,data:await result.json()};
  };
  const login=async(email,password)=>request("/api/auth/login","POST",{email,password});
  try {await run({db,request,login,sent});}finally{await new Promise(resolve=>server.close(resolve));db.close();}
}

test("presence uses authenticated server activity, expires, and clears when sessions end",()=>harness(async({db,request,login})=>{
  const admin=(await login("admin@test.invalid",adminPassword)).data.token;
  let customer=(await login("customer@test.invalid",customerPassword)).data.token;
  const customerStatus=async()=> (await request("/api/admin/users","GET",undefined,admin)).data.users.find(user=>user.id===1);
  assert.equal((await customerStatus()).online,false);
  assert.equal((await request("/api/me/presence","POST",{})).status,401);
  const before=Date.now();
  assert.equal((await request("/api/me/presence","POST",{userId:2,lastSeenAt:1},customer)).status,200);
  assert.equal((await customerStatus()).online,true);
  const stamp=db.prepare("SELECT last_seen_at FROM users WHERE id=1").get().last_seen_at;
  assert.ok(stamp>=before && stamp<=Date.now());
  assert.equal(db.prepare("SELECT last_seen_at FROM users WHERE id=2").get().last_seen_at,null);
  await request("/api/me/presence","POST",{},customer);
  assert.equal(db.prepare("SELECT last_seen_at FROM users WHERE id=1").get().last_seen_at,stamp);
  db.prepare("UPDATE users SET last_seen_at=? WHERE id=1").run(Date.now()-121000);
  assert.equal((await customerStatus()).online,false);
  await request("/api/me/presence","POST",{},customer);
  await request("/api/auth/logout","POST",{},customer);
  assert.equal((await customerStatus()).online,false);
  assert.equal((await request("/api/me/presence","POST",{},customer)).status,401);
  customer=(await login("customer@test.invalid",customerPassword)).data.token;
  await request("/api/me/presence","POST",{},customer);
  assert.equal((await request("/api/admin/users/1","PATCH",{role:"Customer",status:"Inactive",currentPassword:adminPassword},admin)).status,200);
  assert.equal((await customerStatus()).online,false);
  assert.equal(db.prepare("SELECT last_seen_at FROM users WHERE id=1").get().last_seen_at,null);
  assert.equal((await request("/api/me/presence","POST",{},customer)).status,401);
}));
test("signup validation, ignored privilege claims and inactive-account enforcement",()=>harness(async({db,request,login,sent})=>{
  const invalid=await request("/api/auth/signup","POST",{firstName:{},lastName:"Test",email:"test@invalid",password:"short"});
  assert.equal(invalid.status,400);
  const created=await request("/api/auth/signup","POST",{firstName:"New",lastName:"Customer",email:"NEW@test.invalid",password:"ValidTestPassword!",role:"Admin",status:"Active"});
  assert.equal(created.status,201);
  assert.equal(created.data.verificationRequired,true);
  assert.equal(created.data.token,undefined);
  const code=sent.at(-1).text.match(/\b\d{6}\b/)[0];
  const signup=await request("/api/auth/verify-email","POST",{email:"new@test.invalid",code});
  assert.equal(signup.status,200);
  assert.equal(signup.data.user.role,"Customer");
  assert.equal(signup.data.user.firstName,"New");
  assert.equal(signup.data.user.password_hash,undefined);
  assert.equal((await request("/api/admin/users","GET",undefined,signup.data.token)).status,403);
  db.prepare("UPDATE users SET status='Inactive' WHERE id=?").run(signup.data.user.id);
  assert.equal((await request("/api/me","GET",undefined,signup.data.token)).status,401);
  assert.equal((await login("new@test.invalid","ValidTestPassword!")).status,401);
}));
test("profile updates are atomic, email changes need current password, and old sessions are revoked",()=>harness(async({db,request,login})=>{
  let auth=await login("customer@test.invalid",customerPassword),token=auth.data.token;
  assert.equal((await request("/api/me","PUT",{firstName:"Changed",email:"other@test.invalid",currentPassword:customerPassword},token)).status,409);
  assert.equal(db.prepare("SELECT first_name FROM users WHERE id=1").get().first_name,"Test");
  assert.equal((await request("/api/me","PUT",{firstName:"Changed",email:"newaddress@test.invalid",currentPassword:"wrong"},token)).status,400);
  assert.equal(db.prepare("SELECT first_name FROM users WHERE id=1").get().first_name,"Test");
  const updated=await request("/api/me","PUT",{firstName:"Updated",email:"newaddress@test.invalid",phone:"09123456789",currentPassword:customerPassword},token);
  assert.equal(updated.status,200,JSON.stringify(updated.data));
  assert.equal((await request("/api/me","GET",undefined,token)).status,401);
  token=updated.data.token;
  assert.equal((await request("/api/me","GET",undefined,token)).data.user.firstName,"Updated");
  assert.equal((await request("/api/me","PUT",{phone:"123"},token)).status,400);
  const changed=await request("/api/me/password","PATCH",{currentPassword:customerPassword,newPassword:"NewCustomerPassword!"},token);
  assert.equal(changed.status,200);
  assert.equal((await request("/api/me","GET",undefined,token)).status,401);
  assert.equal((await login("newaddress@test.invalid",customerPassword)).status,401);
  assert.equal((await login("newaddress@test.invalid","NewCustomerPassword!")).status,200);
  assert.equal((await request("/api/auth/logout","POST",{},changed.data.token)).status,200);
  assert.equal((await request("/api/me","GET",undefined,changed.data.token)).status,401);
}));
test("photos persist, invalid formats fail, and optional feedback comments are saved",()=>harness(async({db,request,login})=>{
  const token=(await login("customer@test.invalid",customerPassword)).data.token;
  const png="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/C3sAAAAASUVORK5CYII=";
  assert.equal((await request("/api/me/avatar","PUT",{image:"data:image/svg+xml;base64,PHN2Zz4="},token)).status,400);
  assert.equal((await request("/api/me/avatar","PUT",{image:png},token)).status,200);
  assert.equal((await request("/api/me","GET",undefined,token)).data.user.avatar,png);
  assert.equal((await request("/api/me/avatar","DELETE",{},token)).status,200);
  assert.equal((await request("/api/me","GET",undefined,token)).data.user.avatar,null);
  assert.equal((await request("/api/feedback","POST",{rating:5,improveComment:"   ",likedComment:"Coffee",visitFrequency:"Weekly"},token)).status,400);
  assert.equal((await request("/api/feedback","POST",{rating:5,improveComment:"More seats\nMore tables",likedComment:"Coffee",visitFrequency:"Weekly",additionalComment:"Thank you!\nWill visit again."},token)).status,201);
  assert.equal(db.prepare("SELECT additional_comment FROM feedback").get().additional_comment,"Thank you!\nWill visit again.");
}));
test("admin access changes, single-use recovery and role claims are enforced by stored identity",()=>harness(async({db,request,login})=>{
  const adminToken=(await login("admin@test.invalid",adminPassword)).data.token;
  const customerToken=(await login("customer@test.invalid",customerPassword)).data.token;
  const forgedRole=jwt.sign({id:1,role:"Admin"},secret);
  assert.equal((await request("/api/admin/users","GET",undefined,forgedRole)).status,403);
  assert.equal((await request("/api/admin/users/2","PATCH",{role:"Customer",status:"Inactive",currentPassword:adminPassword},adminToken)).status,400);
  assert.equal((await request("/api/admin/users/1/recovery-code","POST",{currentPassword:adminPassword,identityConfirmed:false},adminToken)).status,400);
  const issued=await request("/api/admin/users/1/recovery-code","POST",{currentPassword:adminPassword,identityConfirmed:true},adminToken);
  assert.equal(issued.status,200);
  assert.match(issued.data.code,/^\d{12}$/);
  assert.notEqual(db.prepare("SELECT token_hash FROM password_resets").get().token_hash,issued.data.code);
  const recovered=await request("/api/auth/reset-password","POST",{code:issued.data.code,newPassword:"RecoveredCustomerPassword!"});
  assert.equal(recovered.status,200);
  assert.equal((await request("/api/auth/reset-password","POST",{code:issued.data.code,newPassword:"AnotherLongPassword!"})).status,400);
  assert.equal((await request("/api/me","GET",undefined,customerToken)).status,401);
  assert.equal((await login("customer@test.invalid","RecoveredCustomerPassword!")).status,200);
  const expired=await request("/api/admin/users/1/recovery-code","POST",{currentPassword:adminPassword,identityConfirmed:true},adminToken);
  db.prepare("UPDATE password_resets SET expires_at=0").run();
  assert.equal((await request("/api/auth/reset-password","POST",{code:expired.data.code,newPassword:"NotUsedPassword!"})).status,400);
  assert.equal((await request("/api/admin/users/1","PATCH",{role:"Customer",status:"Inactive",currentPassword:adminPassword},adminToken)).status,200);
  assert.equal((await login("customer@test.invalid","RecoveredCustomerPassword!")).status,401);
}));

test("accounts cannot be deleted: they are archived, keep their records and can be restored",()=>harness(async({db,request,login})=>{
  const adminToken=(await login("admin@test.invalid",adminPassword)).data.token;
  const deleted=await request("/api/admin/users/1","DELETE",{currentPassword:adminPassword,confirmDelete:true},adminToken);
  assert.equal(deleted.status,404);
  assert.ok(db.prepare("SELECT id FROM users WHERE id=1").get());
  // An administrator cannot archive their own account.
  assert.equal((await request("/api/admin/users/2","PATCH",{role:"Admin",status:"Inactive",currentPassword:adminPassword},adminToken)).status,400);
  const archived=await request("/api/admin/users/1","PATCH",{role:"Customer",status:"Inactive",currentPassword:adminPassword},adminToken);
  assert.equal(archived.status,200);
  assert.match(archived.data.message,/archived/);
  assert.equal((await login("customer@test.invalid",customerPassword)).status,401);
  assert.equal((await request("/api/admin/users/1","PATCH",{role:"Customer",status:"Active",currentPassword:adminPassword},adminToken)).status,200);
  assert.equal((await login("customer@test.invalid",customerPassword)).status,200);
}));

test("names cannot contain numbers and passwords need at least 8 characters",()=>harness(async({db,request})=>{
  const account={firstName:"Juan",lastName:"Dela Cruz",email:"juan@test.invalid",password:"eight-ch"};
  assert.match((await request("/api/auth/signup","POST",{...account,firstName:"Juan2"})).data.message,/first name cannot contain numbers/);
  assert.match((await request("/api/auth/signup","POST",{...account,lastName:"Cruz 3rd"})).data.message,/last name cannot contain numbers/);
  assert.match((await request("/api/auth/signup","POST",{...account,middleName:"S4ntos"})).data.message,/middle name cannot contain numbers/);
  assert.match((await request("/api/auth/signup","POST",{...account,password:"seven-c"})).data.message,/at least 8 characters/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE email=?").get(account.email).n,0);
  assert.equal((await request("/api/auth/signup","POST",{...account,firstName:"Ma. José",lastName:"O'Brien-Cruz"})).status,201);
}));

test("delivery address is saved on the account and comes back after logging in again",()=>harness(async({request,login})=>{
  let token=(await login("customer@test.invalid",customerPassword)).data.token;
  assert.equal((await request("/api/me/address","GET",undefined,token)).data.address,null);
  assert.equal((await request("/api/me/address","PUT",{street:"72 Camia St.",barangay:"",city:"Calamba City",province:"Laguna"},token)).status,400);
  const saved={street:"72 Camia St., Villanueva Subd.",barangay:"Lingga",city:"Calamba City",province:"Laguna",landmark:"Blue gate"};
  assert.equal((await request("/api/me/address","PUT",saved,token)).status,200);
  await request("/api/auth/logout","POST",{},token);
  assert.equal((await request("/api/me/address","GET",undefined,token)).status,401);
  token=(await login("customer@test.invalid",customerPassword)).data.token;
  assert.deepEqual((await request("/api/me/address","GET",undefined,token)).data.address,saved);
  const admin=(await login("admin@test.invalid",adminPassword)).data.token;
  assert.equal((await request("/api/me/address","GET",undefined,admin)).data.address,null);
}));

test("admins add employees only; customers sign up on the website",()=>harness(async({request,login})=>{
  const admin=(await login("admin@test.invalid",adminPassword)).data.token;
  const user={firstName:"New",lastName:"Person",email:"new.person@test.invalid",currentPassword:adminPassword};
  const customer=await request("/api/admin/users","POST",{...user,role:"Customer"},admin);
  assert.equal(customer.status,400);
  assert.match(customer.data.message,/Customers sign up/);
  assert.equal((await request("/api/admin/users","POST",{...user,role:"Staff"},admin)).status,201);
}));
