const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../../Customer/Api.js"),"utf8");

function browser(pathname="/Customer/Menu.html",signedIn=true) {
  const values=new Map(signedIn?[["kopi_api_session",JSON.stringify({token:"test-only"})]]:[]);
  const storage={getItem:key=>values.get(key)||null,removeItem:key=>values.delete(key),setItem:(key,value)=>values.set(key,value)};
  const events={},intervals=[],calls=[];
  let now=1000000;
  const document={visibilityState:"visible",addEventListener:(name,fn)=>events[name]=fn};
  const window={location:{protocol:"http:",pathname},addEventListener:(name,fn)=>events[name]=fn,setInterval:(fn,ms)=>intervals.push({fn,ms})};
  const context=vm.createContext({window,document,sessionStorage:storage,localStorage:storage,
    Date:{now:()=>now},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({ok:true})};}});
  vm.runInContext(source,context);
  return {calls,document,events,intervals,values,advance:ms=>now+=ms};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test("presence checks in visible authenticated pages and avoids hidden/signed-out traffic",async()=>{
  const b=browser();
  await settle();
  assert.equal(b.calls.length,1);
  assert.equal(b.calls[0].url,"/api/me/presence");
  assert.equal(b.calls[0].options.headers.Authorization,"Bearer test-only");
  assert.equal(b.intervals[0].ms,45000);
  await b.events.focus();
  assert.equal(b.calls.length,1);
  b.advance(45000);
  b.document.visibilityState="hidden";
  await b.intervals[0].fn();
  assert.equal(b.calls.length,1);
  b.document.visibilityState="visible";
  await b.events.visibilitychange();
  assert.equal(b.calls.length,2);
  b.values.clear();b.advance(45000);
  await b.intervals[0].fn();
  assert.equal(b.calls.length,2);
  const login=browser("/login.html");
  const anonymous=browser("/Customer/Menu.html",false);
  await settle();
  assert.equal(login.calls.length,0);
  assert.equal(login.intervals.length,0);
  assert.equal(anonymous.calls.length,0);
});
