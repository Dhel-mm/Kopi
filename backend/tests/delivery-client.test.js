const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const info = require("../../Customer/DeliveryInfo");
const root = path.resolve(__dirname,"../..");
const tick = () => new Promise(resolve => setImmediate(resolve));
const notification = {orderId:7,orderNumber:"KOPI-0007",riderFee:80,trackingUrl:"https://share.lalamove.com/?test",revision:1,message:info.message(80,"https://share.lalamove.com/?test")};

function harness() {
  const created = [], calls = [], events = {}, notices = [];
  let session = {token:"customer-one",user:{id:1,role:"Customer"}};
  let pending = [notification], failAck = false, deferred = null;
  function element(tag) {
    const el = {tag,children:[],listeners:{},isConnected:true,open:false,disabled:false,
      setAttribute() {}, addEventListener(name,fn) {this.listeners[name]=fn;},
      append(...children) {this.children.push(...children);}, focus() {},
      appendChild(child) {this.children.push(child);},
      showModal() {this.open=true;}, close() {this.open=false;}, remove() {this.isConnected=false;}
    };
    created.push(el); return el;
  }
  const document = {
    visibilityState:"visible", activeElement:element("input"),body:element("body"),createElement:element,
    querySelector:()=>created.find(el=>el.tag==="dialog"&&el.open&&el.isConnected),
    addEventListener(name,fn) {events[name]=fn;}
  };
  const context = {
    document, KopiDeliveryInfo:info,
    KopiApi:{getSession:()=>session, async request(url,options) {
      calls.push({url,options});
      if(options) {
        if(failAck) throw new Error("Offline");
        const revision=JSON.parse(options.body).revision;
        const current=pending.find(item=>url.includes(`/${item.orderId}/`));
        if(current?.revision!==revision) throw Object.assign(new Error("Updated"),{status:409});
        pending=pending.filter(item=>item.orderId!==current.orderId);
        return {};
      }
      if(deferred) return new Promise(resolve=>{deferred.resolve=resolve;});
      return {notifications:pending};
    }},
    KopiNotice:{set(el,message,kind) {el.textContent=message;notices.push(kind);}},
    CustomEvent:class {constructor(type) {this.type=type;}},
    window:{setInterval(fn) {events.interval=fn;},addEventListener(name,fn) {events[name]=fn;},dispatchEvent() {}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(root,"Customer/DeliveryNotifications.js"),"utf8"),context);
  return {context,document,created,calls,events,notices,
    dialogs:()=>created.filter(el=>el.tag==="dialog"&&el.isConnected),
    setSession:value=>{session=value;},setPending:value=>{pending=value;},
    setFail:value=>{failAck=value;},defer:()=>{deferred={};return deferred;}};
}

test("payment rejection replaces delivery notice, explains cancellation, and persists until acknowledged", async () => {
  const h = harness(); await tick();
  const message = "Your order has been canceled because your GCash payment was not received.";
  h.setPending([{orderId:7,orderNumber:"KOPI-0007",type:"cancellation",revision:1,message}]);
  await h.events.interval();
  const modal = h.dialogs()[0];
  assert.equal(modal.children[0].textContent,"Order canceled · KOPI-0007");
  assert.equal(modal.children[1].textContent,message);
  assert.equal(modal.children.some(child=>child.tag === "a"),false);
  h.setFail(true);
  await modal.children.at(-1).listeners.click();
  assert.equal(h.dialogs()[0],modal);
  h.setFail(false);
  await modal.children.at(-1).listeners.click(); await tick();
  assert.ok(h.calls.some(call=>call.url === "/orders/7/cancellation/acknowledge"));
  assert.equal(h.dialogs().length,0);
});

test("delivery popup highlights saved fee and link, opens a safe new-tab link, and OK acknowledges before dismissal",async()=>{
  const h=harness(); await tick();
  const modal=h.dialogs()[0];
  assert.equal(modal.open,true);
  assert.equal(modal.children[0].textContent,"Delivery details · KOPI-0007");
  const parts = modal.children[1].children;
  assert.equal(parts.map(part=>part.textContent).join(""), notification.message);
  assert.deepEqual(parts.filter(part=>part.className === "delivery-notice-value").map(part=>part.textContent), ["₱80.00", notification.trackingUrl]);
  assert.equal(modal.children[2].target,"_blank");
  assert.equal(modal.children[2].rel,"noopener noreferrer");
  let prevented=false; modal.listeners.cancel({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  const ok=modal.children.at(-1);
  await ok.listeners.click(); await tick();
  const ack=h.calls.find(call=>call.options);
  assert.equal(ack.url,"/orders/7/delivery/acknowledge");
  assert.equal(JSON.parse(ack.options.body).revision,1);
  assert.equal(h.dialogs().length,0);
  await h.events.focus(); await h.events.pageshow();
  assert.equal(h.dialogs().length,0);
});

test("Cash delivery popup highlights order cost, rider fee, combined cash and tracking link", async () => {
  const h=harness(); await tick();
  h.setPending([{...notification, revision:2, payment:"Cash", total:120.50}]);
  await h.events.interval();
  const parts=h.dialogs()[0].children[1].children;
  assert.equal(parts.map(part=>part.textContent).join(""), info.message(80,notification.trackingUrl,"Cash",120.50));
  assert.deepEqual(parts.filter(part=>part.className==="delivery-notice-value").map(part=>part.textContent), ["₱120.50","₱80.00","₱200.50",notification.trackingUrl]);
});

test("failed acknowledgement allows retry without silently dismissing or acknowledging",async()=>{
  const h=harness(); await tick();
  h.setFail(true);
  const modal=h.dialogs()[0],ok=modal.children.at(-1);
  await ok.listeners.click();
  assert.equal(h.dialogs().length,1);
  assert.equal(ok.disabled,false);
  assert.equal(h.notices[0],"error");
  await h.events.interval();
  assert.equal(h.dialogs()[0],modal);
  h.setFail(false); await ok.listeners.click(); await tick();
  assert.equal(h.dialogs().length,0);
});

test("updated delivery revisions replace stale notices and another tab's acknowledgement closes a popup",async()=>{
  const h=harness(); await tick();
  const first=h.dialogs()[0];
  h.setPending([{...notification,revision:2,riderFee:90,message:info.message(90,notification.trackingUrl)}]);
  await first.children.at(-1).listeners.click(); await tick();
  assert.equal(h.dialogs().length,1);
  assert.notEqual(h.dialogs()[0],first);
  assert.match(h.dialogs()[0].children[1].children.map(part=>part.textContent).join(""),/₱90\.00/);
  h.setPending([]); await h.events.interval();
  assert.equal(h.dialogs().length,0);
});

test("hidden and signed-out pages do not poll; a response for a previous login never displays",async()=>{
  const h=harness(); await tick();
  h.document.visibilityState="hidden";
  const before=h.calls.length;
  await h.events.interval(); assert.equal(h.calls.length,before);
  h.setSession(null); await h.events.storage(); assert.equal(h.dialogs().length,0);
  h.document.visibilityState="visible";
  h.setSession({token:"one",user:{id:1,role:"Customer"}});
  const deferred=h.defer();
  const check=h.events.focus();
  h.setSession({token:"two",user:{id:3,role:"Customer"}});
  deferred.resolve({notifications:[notification]}); await check;
  assert.equal(h.dialogs().length,0);
});

test("delivery scripts are connected on every customer page and Staff owns the delivery handover dialog",()=>{
  for(const page of ["Homepage","Menu","Cart","Account"]) {
    const html=fs.readFileSync(path.join(root,`Customer/${page}.html`),"utf8");
    assert.ok(html.indexOf('src="Api.js"')<html.indexOf('src="DeliveryNotifications.js"'));
    assert.ok(html.indexOf('src="DeliveryInfo.js"')<html.indexOf('src="DeliveryNotifications.js"'));
    assert.match(html,/src="DeliveryNotifications.js"/);
  }
  const operation=fs.readFileSync(path.join(root,"Admin/Operation.html"),"utf8");
  assert.ok(operation.indexOf('id="orderStatusPanel"')<operation.indexOf('class="operations-table-card"'));
  assert.doesNotMatch(operation,/id="riderFee"/);
  assert.doesNotMatch(operation,/id="riderTrackingLink"/);
  assert.doesNotMatch(operation,/Current Status/);
  assert.doesNotMatch(operation,/Update Order Status/);
  const staff=fs.readFileSync(path.join(root,"Staff/Orders.html"),"utf8");
  assert.match(staff,/id="deliveryDialog"/);
  assert.match(staff,/id="riderFee"[^>]*required/);
  assert.match(staff,/id="riderTrackingLink"[^>]*required/);
  assert.match(staff,/src="\.\.\/Customer\/DeliveryInfo\.js"/);
  const cart=fs.readFileSync(path.join(root,"Customer/Cart.html"),"utf8");
  assert.match(cart,/class="rider-fee-note">\(Pay Delivery Fee directly to the Lalamove Rider\)/);
});
