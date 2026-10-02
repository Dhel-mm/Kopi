const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const express = require("express");
const jwt = require("jsonwebtoken");
const {fixture, customer, admin, body} = require("./fixtures");
const {createOrderWorkflow} = require("../services/orderWorkflow");
const {createDeliveryService} = require("../services/delivery");
const {migrateOrderWorkflow} = require("../services/orderSchema");
const info = require("../../Customer/DeliveryInfo");
const link = "https://share.lalamove.com/?order=test-order&sign=test-only";
const input = (overrides = {}) => ({fee: 80, trackingUrl: link, revision: 0, ...overrides});
process.env.JWT_SECRET = "isolated-delivery-test-secret-not-for-production";

function prepared(db, user = customer) {
  const flow = createOrderWorkflow(db);
  const order = flow.create(body(), user);
  flow.advance(order.orderId, "Preparing", admin);
  return order;
}

test("delivery info is persisted separately from totals and stock, survives reload, and acknowledgement retains tracking", () => {
  const db = fixture();
  let reopened;
  try {
    const order = prepared(db), delivery = createDeliveryService(db);
    const before = db.prepare("SELECT total,subtotal,delivery_fee,voucher_discount FROM orders WHERE id=?").get(order.orderId);
    const movements = db.prepare("SELECT COUNT(*) AS count FROM inventory_transactions").get().count;
    const saved = delivery.save(order.orderId, input(), admin);
    assert.equal(saved.riderFee, 80);
    assert.equal(saved.revision, 1);
    assert.equal(saved.message, info.message(80, link));
    assert.equal(saved.acknowledgedAt, null);
    assert.deepEqual(db.prepare("SELECT total,subtotal,delivery_fee,voucher_discount FROM orders WHERE id=?").get(order.orderId), before);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_transactions").get().count, movements);
    assert.equal(delivery.pending(customer).length, 1);
    assert.equal(delivery.pending({id:3}).length, 0);
    assert.throws(() => delivery.acknowledge(order.orderId, 1, {id:3}), /not found/);
    delivery.acknowledge(order.orderId, 1, customer);
    assert.equal(delivery.pending(customer).length, 0);
    assert.ok(delivery.read(order.orderId).acknowledgedAt);
    // Reopen the SQLite image and rerun the migration: no frontend state is involved.
    reopened = new Database(db.serialize());
    migrateOrderWorkflow(reopened);
    const reloaded = createDeliveryService(reopened);
    assert.equal(reloaded.pending(customer).length, 0);
    assert.equal(reloaded.read(order.orderId).trackingUrl, link);
    assert.equal(reloaded.read(order.orderId).riderFee, 80);
  } finally { reopened?.close(); db.close(); }
});

test("delivery validation rejects blank fees and unsafe links and never alters a different order", () => {
  const db = fixture();
  try {
    const order = prepared(db), delivery = createDeliveryService(db);
    for (const fee of [undefined, null, "", "80", -1, NaN, Infinity, 1.001, 1000001]) {
      assert.throws(() => delivery.save(order.orderId, input({fee}), admin));
    }
    for (const trackingUrl of ["", "javascript:alert(1)", "data:text/html,test", "http://share.lalamove.com/test", "https://lalamove.com.evil.test/", "https://evil.test/lalamove.com", "https://user:pass@share.lalamove.com/", "https://127.0.0.1/", "https://share.lalamove.com:8080/", "https://share.lalamove.com/\nfoo"]) {
      assert.throws(() => delivery.save(order.orderId, input({trackingUrl}), admin), /Lalamove/);
    }
    assert.throws(() => delivery.save(order.orderId, input(), customer), /Administrator/);
    assert.throws(() => delivery.save(9999, input(), admin), /not found/);
    assert.equal(delivery.read(order.orderId).revision, 0);
    assert.equal(delivery.save(order.orderId, input({fee:0}), admin).riderFee, 0);
    assert.equal(info.trackingUrl("https://lalamove.app.link/test"), "https://lalamove.app.link/test");
  } finally { db.close(); }
});

test("identical sends and acknowledgements are idempotent; revisions prevent stale acknowledgement and overwrite", () => {
  const db = fixture();
  try {
    const order = prepared(db), delivery = createDeliveryService(db);
    delivery.save(order.orderId, input(), admin);
    delivery.acknowledge(order.orderId, 1, customer);
    const first = delivery.read(order.orderId);
    assert.deepEqual(delivery.save(order.orderId, input(), admin), first);
    assert.deepEqual(delivery.acknowledge(order.orderId, 1, customer), first);
    const edited = delivery.save(order.orderId, input({fee:90.5, revision:1}), admin);
    assert.equal(edited.revision, 2);
    assert.equal(edited.acknowledgedAt, null);
    assert.match(edited.message, /₱90\.50/);
    assert.throws(() => delivery.acknowledge(order.orderId, 1, customer), /updated/);
    assert.throws(() => delivery.save(order.orderId, input({fee:100, revision:1}), admin), /changed/);
    assert.equal(delivery.pending(customer)[0].revision, 2);
  } finally { db.close(); }
});

test("delivery notices are online-only, not sent before preparation, and canceled orders leave the inbox", () => {
  const db = fixture();
  try {
    const flow = createOrderWorkflow(db), delivery = createDeliveryService(db);
    const fresh = flow.create(body(), customer);
    assert.throws(() => delivery.save(fresh.orderId, input(), admin), /being prepared/);
    const pos = flow.create(body({serviceType:"Takeout"}), admin, true);
    assert.throws(() => delivery.save(pos.orderId, input(), admin), /online/);
    flow.advance(fresh.orderId, "Preparing", admin);
    delivery.save(fresh.orderId, input(), admin);
    flow.cancel(fresh.orderId, customer);
    assert.equal(delivery.pending(customer).length, 0);
    assert.equal(delivery.read(fresh.orderId).riderFee, 80);
    assert.throws(() => delivery.save(fresh.orderId, input({fee:90,revision:1}), admin), /being prepared/);
    const other = prepared(db);
    delivery.save(other.orderId, input(), admin);
    flow.advance(other.orderId, "Out for Delivery", admin);
    flow.advance(other.orderId, "Arrived", admin);
    flow.advance(other.orderId, "Completed", admin);
    assert.equal(db.prepare("SELECT total FROM orders WHERE id=?").get(other.orderId).total, 160);
    assert.equal(delivery.pending(customer)[0].orderId, other.orderId);
    delivery.acknowledge(other.orderId, 1, customer);
    assert.equal(delivery.pending(customer).length, 0);
  } finally { db.close(); }
});

test("HTTP delivery routes enforce admin management and owner-only reading/acknowledgement", async () => {
  const db = fixture(), app = express();
  const order = prepared(db);
  const other = prepared(db, {id:3,role:"Customer"});
  app.use(express.json());
  app.use("/admin", require("../routes/adminOrders")(db));
  app.use("/orders", require("../routes/orders")(db));
  const server = await new Promise(resolve => { const s = app.listen(0,"127.0.0.1",() => resolve(s)); });
  async function request(url, method = "GET", payload, user = customer) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method, headers: {"Content-Type":"application/json", ...(user ? {Authorization:"Bearer " + jwt.sign(user,process.env.JWT_SECRET)} : {})},
      ...(payload ? {body:JSON.stringify(payload)} : {})
    });
    return {status:res.status,data:await res.json()};
  }
  try {
    assert.equal((await request("/orders/delivery-notifications","GET",null,null)).status,401);
    assert.equal((await request(`/admin/orders/${order.orderId}/delivery`,"PUT",input())).status,403);
    assert.equal((await request(`/admin/orders/${order.orderId}/delivery`,"PUT",input(),admin)).status,200);
    assert.equal((await request(`/admin/orders/${other.orderId}/delivery`,"PUT",input({fee:25}),admin)).status,200);
    assert.equal((await request("/orders/delivery-notifications","GET",null,admin)).status,403);
    const pending = (await request("/orders/delivery-notifications")).data.notifications;
    assert.equal(pending.length,1); assert.equal(pending[0].orderId,order.orderId);
    const mine = (await request("/orders/my")).data.orders;
    assert.equal(mine.length,1); assert.equal(mine[0].riderFee,80); assert.equal(mine[0].total,160);
    assert.equal((await request(`/orders/${other.orderId}/delivery/acknowledge`,"PATCH",{revision:1})).status,404);
    assert.equal((await request(`/orders/${order.orderId}/delivery/acknowledge`,"PATCH",{revision:0})).status,409);
    assert.equal((await request(`/orders/${order.orderId}/delivery/acknowledge`,"PATCH",{revision:1})).status,200);
    assert.equal((await request("/orders/delivery-notifications")).data.notifications.length,0);
    const after = (await request("/orders/my")).data.orders[0];
    assert.equal(after.trackingUrl,link); assert.equal(after.riderFee,80); assert.ok(after.deliveryAcknowledgedAt);
    const all = (await request("/admin/orders","GET",null,admin)).data.orders;
    assert.equal(all.find(entry=>entry.id===order.orderId).deliveryRevision,1);
  } finally { await new Promise(resolve=>server.close(resolve)); db.close(); }
});
