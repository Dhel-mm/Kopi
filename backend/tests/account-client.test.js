const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

function element() {
  return {hidden:false,disabled:false,value:"",textContent:"",dataset:{},listeners:{},
    classList:{add(){},remove(){},toggle(){}},
    addEventListener(name,listener){this.listeners[name]=listener;},
    setAttribute(){},focus(){},click(){},reset(){},querySelectorAll(){return [];},
    querySelector(){return this.submitButton;},elements:{}};
}
function accountHarness() {
  const ids=new Map(),selectors=new Map(),focusHandlers={},calls=[];
  const get=id=>{if(!ids.has(id))ids.set(id,element());return ids.get(id);};
  const stars=Array.from({length:5},(_,index)=>Object.assign(element(),{dataset:{rating:String(index+1)}}));
  const profile=get("profileForm"),feedback=get("feedbackForm");
  for(const name of ["firstName","lastName","email","phone"])profile.elements[name]=element();
  feedback.submitButton=element();profile.submitButton=element();
  const panels=["profile","orders","feedback","about"].map(get);
  let resolveFeedback;
  const document={
    hidden:false,getElementById:get,
    querySelector(selector){if(!selectors.has(selector))selectors.set(selector,element());return selectors.get(selector);},
    querySelectorAll(selector){return selector===".star"?stars:selector===".account-panel"?panels:[];}
  };
  const KopiApi={request:async(url,options)=>{
    calls.push({url,options});
    if(url==="/me")return {user:{firstName:"Saved",lastName:"Customer",email:"test@example.invalid"}};
    if(url==="/orders/my")return {orders:[]};
    if(url==="/feedback")return new Promise(resolve=>{resolveFeedback=resolve;});
    throw new Error("Unexpected request: "+url);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../../Customer/Account.js"),"utf8"),{
    document,KopiApi,KopiProfile:{avatar(){}},alert(){},setInterval(){},setTimeout(){},
    history:{replaceState(){}},window:{location:{hash:"",replace(){}},addEventListener(name,fn){focusHandlers[name]=fn;}}
  });
  return {get,stars,profile,feedback,calls,focusHandlers,finishFeedback:()=>resolveFeedback({message:"Saved"})};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test("feedback sends optional comments and blocks duplicate clicks while saving",async()=>{
  const h=accountHarness();await tick();
  h.stars[4].listeners.click();
  for(const [id,value] of Object.entries({improve:"More tables",love:"Coffee",visit:"Weekly",comments:"Keep it up!\nThanks."}))h.get(id).value=value;
  const pending=h.feedback.listeners.submit({preventDefault(){}});
  assert.equal(h.feedback.submitButton.disabled,true);
  await h.feedback.listeners.submit({preventDefault(){}});
  const posted=h.calls.filter(call=>call.url==="/feedback");
  assert.equal(posted.length,1);
  assert.equal(JSON.parse(posted[0].options.body).additionalComment,"Keep it up!\nThanks.");
  h.finishFeedback();await pending;
  assert.equal(h.feedback.submitButton.disabled,false);
  assert.equal(h.get("ratingText").textContent,"Click a star to rate");
});
test("returning to the account window preserves profile drafts and only refreshes visible orders",async()=>{
  const h=accountHarness();await tick();
  h.profile.elements.firstName.value="Unsaved draft";
  const count=url=>h.calls.filter(call=>call.url===url).length;
  const profileCalls=count("/me"),orderCalls=count("/orders/my");
  h.focusHandlers.focus();await tick();
  assert.equal(h.profile.elements.firstName.value,"Unsaved draft");
  assert.equal(count("/me"),profileCalls);
  assert.equal(count("/orders/my"),orderCalls);
  h.get("orders").hidden=false;h.focusHandlers.focus();await tick();
  assert.equal(count("/orders/my"),orderCalls+1);
});
test("profile confirmation is validated before any save and successful saves replace the session",async()=>{
  const calls=[],sessions=[];
  const result={message:"Saved",token:"replacement",user:{id:1}};
  class TestFormData {constructor(form){return Object.entries(form.values)[Symbol.iterator]();}}
  const profile=vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../../Customer/ProfileTools.js"),"utf8")+";KopiProfile",{
    FormData:TestFormData,KopiApi:{request:async(...args)=>{calls.push(args);return result;},saveSession:data=>sessions.push(data)}
  });
  const form={values:{firstName:"New name",newPassword:"LongNewPassword!",confirmPassword:"Mismatch"},elements:{}};
  for(const name of ["currentPassword","newPassword","confirmPassword"])form.elements[name]={value:"secret"};
  await assert.rejects(()=>profile.save(form),/do not match/);
  assert.equal(calls.length,0);
  form.values.confirmPassword=form.values.newPassword;
  await profile.save(form);
  assert.equal(calls.length,1);
  assert.equal(JSON.parse(calls[0][1].body).firstName,"New name");
  assert.equal(sessions[0],result);
  assert.equal(form.elements.currentPassword.value,"");
});
