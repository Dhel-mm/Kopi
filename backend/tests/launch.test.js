const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const Database=require("better-sqlite3");
const {fixture}=require("./fixtures");
const {createApp}=require("../app");
const {config,checkConfig}=require("../config");
const {copyDatabase,verifyDatabase}=require("../services/backups");
process.env.JWT_SECRET="launch-tests-only-unique-secret-not-used-in-production";
test("private files are never served; JSON errors are safe and health reveals no users",async()=>{
  const db=fixture(),app=createApp(db,{origin:"http://localhost:3000"});
  const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  const base="http://127.0.0.1:"+server.address().port;
  try {
    for(const resource of ["/backend/.env","/backend/data/kopi.db","/.env","/Workflow.js","/backend/tests/fixtures.js","/Customer/../backend/database.js"]) {
      assert.equal((await fetch(base+resource)).status,404,resource);
    }
    const homepage=await fetch(base+"/");
    assert.ok(homepage.url.endsWith("/splash.html"));
    assert.equal(homepage.headers.get("x-powered-by"),null);
    assert.match(homepage.headers.get("content-security-policy"),/frame-ancestors 'none'/);
    assert.equal((await fetch(base+"/login.html")).status,200);
    const health=await fetch(base+"/api/health");
    assert.equal(health.headers.get("cache-control"),"no-store");
    assert.deepEqual(await health.json(),{status:"ok"});
    const malformed=await fetch(base+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:'{"email":'});
    assert.equal(malformed.status,400);
    const message=await malformed.text();
    assert.ok(!message.includes("node_modules"));
    const foreign=await fetch(base+"/api/health",{headers:{Origin:"https://attacker.invalid"}});
    assert.equal(foreign.status,403);
    const oversized=await fetch(base+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({value:"x".repeat(900000)})});
    assert.equal(oversized.status,413);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
test("rate limiting persists in the database and limits authentication attempts",async()=>{
  const db=fixture(),app=createApp(db,{origin:"http://localhost:3000"});
  const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  const url="http://127.0.0.1:"+server.address().port+"/api/auth/login";
  try {
    for(let i=0;i<40;i++) {
      const result=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      assert.equal(result.status,400);
    }
    const blocked=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
    assert.equal(blocked.status,429);
    assert.ok(Number(blocked.headers.get("retry-after"))>0);
    assert.equal(db.prepare("SELECT hits FROM request_limits").get().hits,41);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
test("production cannot start with placeholders or an HTTP origin",()=>{
  const unsafe={NODE_ENV:"production",JWT_SECRET:"change-this-to-a-long-random-secret",ADMIN_EMAIL:"admin@test.invalid",ADMIN_PASSWORD:"ChooseYourOwnStrongAdminPassword",APP_ORIGIN:"http://localhost:3000"};
  assert.ok(checkConfig(unsafe).length>=3);
  assert.throws(()=>config(unsafe),/blocked/);
  const safe={...unsafe,JWT_SECRET:"7b8cf533529260893d6635881f714a3d77068cb2f452ed512",ADMIN_PASSWORD:"UniqueDemoPasswordOnly!",APP_ORIGIN:"https://shop.invalid"};
  assert.equal(config(safe).production,true);
  assert.equal(config(safe).host,"127.0.0.1");
});
test("online backup and restore to a new file preserve data without overwriting the source",async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),"kopi-backup-test-"));
  const source=path.join(temporary,"source.db"),backup=path.join(temporary,"backup.db"),restored=path.join(temporary,"restored.db");
  const db=fixture();
  try {
    await db.backup(source);
    await copyDatabase(source,backup);
    await copyDatabase(backup,restored);
    assert.deepEqual(verifyDatabase(source),verifyDatabase(restored));
    const check=new Database(restored,{readonly:true});
    assert.equal(check.prepare("SELECT COUNT(*) AS n FROM inventory_items").get().n,db.prepare("SELECT COUNT(*) AS n FROM inventory_items").get().n);
    check.close();
    await assert.rejects(()=>copyDatabase(source,restored),/never overwritten/);
  }finally{
    db.close();
    // Only our named temporary files, no recursive deletion or shared paths.
    for(const name of fs.readdirSync(temporary))fs.unlinkSync(path.join(temporary,name));
    fs.rmdirSync(temporary);
  }
});

test("TRUST_PROXY supports loopback, a hop count, and hosted platforms such as Render",()=>{
  const {config}=require("../config");
  const base={JWT_SECRET:"x".repeat(40)};
  assert.equal(config(base).trustProxy,false);
  assert.equal(config({...base,TRUST_PROXY:"loopback"}).trustProxy,"loopback");
  assert.equal(config({...base,TRUST_PROXY:"2"}).trustProxy,2);
  assert.equal(config({...base,TRUST_PROXY:"true"}).trustProxy,true);
  assert.equal(config({...base,TRUST_PROXY:"yes please"}).trustProxy,false);
});
