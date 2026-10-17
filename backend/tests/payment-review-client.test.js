const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const elements = new Map(), calls = [], events = {};
  let confirmation = true, fail = false;
  const order = {id:7,orderNumber:"KOPI-0007",orderType:"Online",status:"New",payment:"GCash",
    paymentStatus:"Pending verification",paymentReference:"123456789",total:160,createdAt:"2026-10-15T00:00:00Z"};
  function node() {
    return {children:[],listeners:{},open:false,classList:{remove(){}},
      addEventListener(name,fn){this.listeners[name]=fn;},removeAttribute(){},
      replaceChildren(){this.children=[];},appendChild(child){this.children.push(child);},
      querySelectorAll(){return [];},querySelector(){return null;},
      showModal(){this.open=true;},close(){this.open=false;}};
  }
  function get(id) {if(!elements.has(id)) elements.set(id,node()); return elements.get(id);}
  const context = vm.createContext({
    document:{getElementById:get,createElement:node,querySelectorAll(){return [];}},
    window:{confirm:()=>confirmation,addEventListener(name,fn){events[name]=fn;}},
    KopiNotice:{toast(){},set(){}},KopiApi:{async request(url,options){
      calls.push({url,options});
      if (!options) return {orders:[order]};
      await tick();
      if (fail) throw new Error("Offline");
      order.status="Canceled";order.paymentStatus="Not received";
      order.cancellationReason="Your order has been canceled because your GCash payment was not received.";
      return {message:order.cancellationReason};
    }}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../../Admin/Operation.js"),"utf8"),context);
  return {get,calls,events,order,select:()=>vm.runInContext("selectOrder(7)",context),
    confirm:value=>{confirmation=value;},fail:value=>{fail=value;}};
}

test("rejection button is below Verify; confirmation and double-click protection cancel once", async () => {
  const h=harness(); await tick();h.select();
  const [verify,reject]=h.get("selectedPaymentActions").children;
  assert.equal(verify.className,"verify-payment-btn");
  assert.equal(reject.className,"reject-payment-btn");
  h.confirm(false);await reject.listeners.click();
  assert.equal(h.calls.filter(call=>call.options).length,0);
  h.confirm(true);
  const pending=reject.listeners.click();
  assert.equal(verify.disabled,true);assert.equal(reject.disabled,true);
  await reject.listeners.click();await h.events.focus();
  assert.equal(h.calls.filter(call=>call.options).length,1);
  await pending;
  assert.equal(h.calls.find(call=>call.options).url,"/admin/orders/7/reject-payment");
  assert.deepEqual(JSON.parse(h.calls.find(call=>call.options).options.body),{confirmedNotReceived:true});
  assert.equal(h.get("selectedPaymentActions").children.length,0);
  assert.match(h.get("selectedPaymentActions").textContent,/payment was not received/);
});

test("failed rejection keeps the order unchanged and allows retry", async () => {
  const h=harness();await tick();h.select();h.fail(true);
  await h.get("selectedPaymentActions").children[1].listeners.click();
  assert.equal(h.order.status,"New");
  assert.equal(h.get("selectedPaymentActions").children.length,2);
  h.fail(false);
  await h.get("selectedPaymentActions").children[1].listeners.click();
  assert.equal(h.order.status,"Canceled");
});
