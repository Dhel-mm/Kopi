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
  const app=createApp(db,{origin:"http://localhost:3000"});
  const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  const request=async(path,method="GET",body,token)=>{
    const result=await fetch("http://127.0.0.1:"+server.address().port+path,{method,headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:result.status,data:await result.json()};
  };
  const login=async(email,password)=>request("/api/auth/login","POST",{email,password});
  try {await run({db,request,login});}finally{await new Promise(resolve=>server.close(resolve));db.close();}
}
test("signup validation, ignored privilege claims and inactive-account enforcement",()=>harness(async({db,request,login})=>{
  const invalid=await request("/api/auth/signup","POST",{firstName:{},lastName:"Test",email:"test@invalid",password:"short"});
  assert.equal(invalid.status,400);
  const signup=await request("/api/auth/signup","POST",{firstName:"New",lastName:"Customer",email:"NEW@test.invalid",password:"ValidTestPassword!",role:"Admin",status:"Active"});
  assert.equal(signup.status,201);
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
