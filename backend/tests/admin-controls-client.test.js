const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../..");
const tick = () => new Promise(resolve => setImmediate(resolve));

function node() {
  return {
    hidden: false, open: false, disabled: false, value: "", checked: true, children: [], attributes: {}, listeners: {},
    addEventListener(name, handler) { this.listeners[name] = handler; },
    setAttribute(name, value) { this.attributes[name] = value; },
    focus() { this.focused = true; },
    showModal() { this.open = true; },
    close() { this.open = false; this.listeners.close?.(); },
    append(...items) { this.children.push(...items); },
    replaceChildren() { this.children = []; },
    reportValidity() { return true; },
    reset() {}
  };
}

test("voucher dialog opens, retains drafts on close, and saves and edits through the API", async () => {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, node());
    return nodes.get(id);
  };
  let vouchers = [];
  const writes = [];
  const context = {
    document: {getElementById: get, createElement: node},
    KopiNotice: {set(target, message) { target.textContent = message; }},
    KopiApi: {async request(url, options) {
      if (!options) return {vouchers};
      writes.push({url, ...options});
      vouchers = [JSON.parse(options.body)];
      return {voucher: vouchers[0]};
    }}
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "Admin/Vouchers.js"), "utf8"), context);
  await tick();
  assert.equal(get("voucherCard").open, false);
  get("toggleVouchers").listeners.click();
  assert.equal(get("voucherCard").open, true);
  assert.equal(get("toggleVouchers").attributes["aria-expanded"], "true");
  assert.equal(get("adminVoucherCode").focused, true);
  get("adminVoucherCode").value = "school50";
  get("adminVoucherAmount").value = "50";
  get("closeVouchers").listeners.click();
  assert.equal(get("voucherCard").open, false);
  assert.equal(get("adminVoucherCode").value, "school50");
  assert.equal(get("toggleVouchers").attributes["aria-expanded"], "false");
  get("toggleVouchers").listeners.click();
  const pending = get("voucherForm").listeners.submit({preventDefault() {}});
  let canceled = false;
  get("voucherCard").listeners.cancel({preventDefault() { canceled = true; }});
  assert.equal(canceled, true);
  assert.equal(get("closeVouchers").disabled, true);
  await get("voucherForm").listeners.submit({preventDefault() {}});
  await pending;
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "POST");
  assert.deepEqual(JSON.parse(writes[0].body), {code: "SCHOOL50", amount: 50, active: true});
  assert.equal(get("voucherFields").disabled, false);
  assert.equal(get("closeVouchers").disabled, false);
  get("voucherList").children[0].children[1].listeners.click();
  assert.equal(get("adminVoucherCode").readOnly, true);
  get("adminVoucherAmount").value = "25";
  get("adminVoucherActive").checked = false;
  await get("voucherForm").listeners.submit({preventDefault() {}});
  assert.equal(writes[1].method, "PUT");
  assert.equal(writes[1].url, "/admin/vouchers/SCHOOL50");
  assert.deepEqual(JSON.parse(writes[1].body), {code: "SCHOOL50", amount: 25, active: false});
});

test("voucher entry moved exclusively to Operations beside filters without its chevron", () => {
  const dashboard = fs.readFileSync(path.join(root, "Admin/Dashboard.html"), "utf8");
  const operation = fs.readFileSync(path.join(root, "Admin/Operation.html"), "utf8");
  assert.doesNotMatch(dashboard, /toggleVouchers|voucherCard|Vouchers\.js/);
  assert.match(operation, /<dialog class="voucher-card voucher-dialog"/);
  const toolbar = operation.slice(operation.indexOf('class="operation-status-tools"'), operation.indexOf('class="order-status-panel"'));
  assert.match(toolbar, /status-filter[\s\S]*id="toggleVouchers"/);
  assert.doesNotMatch(toolbar, /bi-chevron-down/);
  const selected = operation.slice(operation.indexOf('class="selected-order"'), operation.indexOf('class="operations-table-card"'));
  assert.match(selected, /selectedOrderSummary[\s\S]*order-contact-details[\s\S]*orderAddress[\s\S]*orderPhone/);
  assert.match(operation, /Review order details and verify GCash payments/);
  assert.doesNotMatch(operation, /Current Status|Update Order Status|Send Delivery Details/);
});

test("used voucher is red and offers a confirmed Remove action instead of Edit", async () => {
  const nodes=new Map(),writes=[];
  const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  let vouchers=[{code:"USED50",amount:50,active:true,used:true}],confirm=false;
  vm.runInNewContext(fs.readFileSync(path.join(root,"Admin/Vouchers.js"),"utf8"),{
    document:{getElementById:get,createElement:node},window:{confirm:()=>confirm},
    KopiNotice:{set(target,message){target.textContent=message;}},
    KopiApi:{async request(url,options){if(!options)return {vouchers};writes.push({url,...options});vouchers=[];return {};}}
  });
  await tick();
  const row=get("voucherList").children[0],button=row.children[1];
  assert.equal(row.children[0].children[0].className,"voucher-used-code");
  assert.match(fs.readFileSync(path.join(root,"Admin/Vouchers.css"),"utf8"),/\.voucher-used-code\s*\{\s*color: #9d3035/);
  assert.equal(button.textContent,"Remove");
  await button.listeners.click();assert.equal(writes.length,0);
  confirm=true;await button.listeners.click();
  assert.equal(writes[0].method,"DELETE");assert.equal(writes[0].url,"/admin/vouchers/USED50");
  assert.equal(get("voucherList").children.length,0);
});

function logoutHarness(fail = false) {
  const messages = [], timers = [];
  let calls = 0;
  const context = {
    document: {querySelector: () => null},
    KopiApi: {async logout() { calls++; if (fail) throw new Error("Offline"); }},
    KopiNotice: {toast(message, kind) { messages.push({message, kind}); }},
    setTimeout(callback, delay) { timers.push({callback, delay}); },
    window: {location: {href: ""}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "Admin/AdminProfile.js"), "utf8"), context);
  return {context, messages, timers, calls: () => calls};
}

test("admin logout shows success before redirect and prevents repeated requests", async () => {
  const h = logoutHarness(), button = node();
  const pending = h.context.logoutAdmin(button);
  await tick();
  assert.equal(button.disabled, true);
  assert.deepEqual(h.messages, [{message: "Successfully Logged out", kind: "success"}]);
  assert.equal(h.context.window.location.href, "");
  await h.context.logoutAdmin(button);
  assert.equal(h.calls(), 1);
  assert.equal(h.timers[0].delay, 1200);
  h.timers[0].callback();
  await pending;
  assert.equal(h.context.window.location.href, "../login.html");
});

test("offline logout reports local sign-out as a warning, not full success", async () => {
  const h = logoutHarness(true);
  const pending = h.context.logoutAdmin(node());
  await tick();
  assert.equal(h.messages[0].kind, "warning");
  assert.match(h.messages[0].message, /Signed out locally/);
  assert.equal(h.timers[0].delay, 3500);
  h.timers[0].callback();
  await pending;
  assert.equal(h.context.window.location.href, "../login.html");
});
