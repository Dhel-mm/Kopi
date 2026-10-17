const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const express = require("express");
const jwt = require("jsonwebtoken");
const {fixture, customer, admin, body} = require("./fixtures");
const {createOrderWorkflow} = require("../services/orderWorkflow");
const {createPaymentReviewService, rejectionMessage} = require("../services/paymentReview");
const {migrateOrderWorkflow} = require("../services/orderSchema");
const confirmed = {confirmedNotReceived:true};
const gcash = () => body({payment:"GCash", paymentReference: String(Date.now())});
const stock = db => db.prepare("SELECT id,quantity FROM inventory_items ORDER BY id").all();

test("rejecting unpaid GCash cancels, restores reserved ingredients once, and persists owner-only notice", () => {
  const db = fixture(); let reopened;
  try {
    const flow = createOrderWorkflow(db), review = createPaymentReviewService(db);
    const before = stock(db), order = flow.create(gcash(), customer);
    assert.notDeepEqual(stock(db), before);
    assert.throws(() => review.reject(order.orderId, confirmed, customer), /Administrator/);
    assert.throws(() => review.reject(order.orderId, {}, admin), /confirm/);
    const canceled = review.reject(order.orderId, confirmed, admin);
    assert.equal(canceled.status, "Canceled");
    assert.equal(canceled.paymentStatus, "Not received");
    assert.equal(canceled.refundStatus, "Not required");
    assert.deepEqual(stock(db), before);
    const movements = db.prepare("SELECT COUNT(*) AS n FROM inventory_transactions").get().n;
    review.reject(order.orderId, confirmed, admin);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_transactions").get().n, movements);
    assert.equal(review.pending(customer).length, 1);
    assert.equal(review.pending({id:3}).length, 0);
    assert.throws(() => review.acknowledge(order.orderId, {id:3}), /not found/);
    assert.throws(() => flow.advance(order.orderId, "Preparing", admin), /transition/);
    const saved = db.prepare("SELECT * FROM orders WHERE id=?").get(order.orderId);
    assert.equal(saved.cancellation_reason, rejectionMessage);
    assert.equal(saved.payment_rejected_by, admin.id);
    assert.ok(saved.payment_rejected_at);
    reopened = new Database(db.serialize());
    migrateOrderWorkflow(reopened);
    const reloaded = createPaymentReviewService(reopened);
    assert.equal(reloaded.pending(customer)[0].message, rejectionMessage);
    reloaded.acknowledge(order.orderId, customer);
    reloaded.acknowledge(order.orderId, customer);
    assert.equal(reloaded.pending(customer).length, 0);
    assert.equal(reopened.prepare("SELECT cancellation_reason FROM orders WHERE id=?").get(order.orderId).cancellation_reason, rejectionMessage);
  } finally {reopened?.close(); db.close();}
});

test("cash, verified, canceled and fulfilled orders cannot be rejected; preparation stock stays consumed", () => {
  const db = fixture();
  try {
    const flow = createOrderWorkflow(db), review = createPaymentReviewService(db);
    const cash = flow.create(body(), customer);
    assert.throws(() => review.reject(cash.orderId, confirmed, admin), /unverified/);
    const order = flow.create(gcash(), customer);
    for (const status of ["Canceled", "Out for Delivery", "Arrived", "Completed"]) {
      db.prepare("UPDATE orders SET status=? WHERE id=?").run(status, order.orderId);
      assert.throws(() => review.reject(order.orderId, confirmed, admin), /unverified/);
    }
    db.prepare("UPDATE orders SET status='New',payment_status='Verified' WHERE id=?").run(order.orderId);
    assert.throws(() => review.reject(order.orderId, confirmed, admin), /unverified/);
    db.prepare("UPDATE orders SET status='Preparing',inventory_state='consumed',payment_status='Pending verification' WHERE id=?").run(order.orderId);
    const before = stock(db);
    assert.equal(review.reject(order.orderId, confirmed, admin).inventoryState, "consumed");
    assert.deepEqual(stock(db), before);
    assert.throws(() => review.reject(999999, confirmed, admin), /not found/);
  } finally {db.close();}
});

test("HTTP rejection requires Admin confirmation; customer sees reason and acknowledges only their notice", async () => {
  process.env.JWT_SECRET = "isolated-payment-rejection-test-secret-not-for-production";
  const db = fixture(), app = express();
  const order = createOrderWorkflow(db).create(gcash(), customer);
  app.use(express.json());
  app.use("/admin", require("../routes/adminOrders")(db));
  app.use("/orders", require("../routes/orders")(db));
  app.use("/workforce", require("../routes/workforce")(db));
  app.use("/reports", require("../routes/reports")(db));
  const server = await new Promise(resolve => {const s = app.listen(0,"127.0.0.1",()=>resolve(s));});
  async function request(url, method="GET", payload, user=customer) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method, headers:{"Content-Type":"application/json", ...(user ? {Authorization:`Bearer ${jwt.sign(user,process.env.JWT_SECRET)}`} : {})},
      ...(payload ? {body:JSON.stringify(payload)} : {})
    });
    return {status:response.status, data:await response.json()};
  }
  try {
    const endpoint = `/admin/orders/${order.orderId}/reject-payment`;
    assert.equal((await request(endpoint,"PATCH",confirmed,null)).status,401);
    assert.equal((await request(endpoint,"PATCH",confirmed)).status,403);
    assert.equal((await request(endpoint,"PATCH",{},admin)).status,400);
    assert.equal((await request(endpoint,"PATCH",confirmed,admin)).status,200);
    assert.equal((await request(endpoint,"PATCH",confirmed,admin)).status,200);
    assert.equal((await request(`/admin/orders/${order.orderId}/verify-payment`,"PATCH",{confirmedReceived:true},admin)).status,400);
    assert.equal((await request("/orders/my")).data.orders[0].cancellationReason,rejectionMessage);
    assert.equal((await request("/admin/orders","GET",null,admin)).data.orders[0].cancellationReason,rejectionMessage);
    assert.equal((await request("/workforce/preparation","GET",null,admin)).data.orders.length,0);
    const transactions = (await request("/reports/transactions","GET",null,admin)).data;
    assert.equal(transactions.transactions[0].status,"Canceled");
    assert.equal(transactions.filteredSales,0);
    assert.equal((await request("/orders/notifications")).data.notifications[0].type,"cancellation");
    assert.equal((await request("/orders/notifications","GET",null,{id:3,role:"Customer"})).data.notifications.length,0);
    const ack = `/orders/${order.orderId}/cancellation/acknowledge`;
    assert.equal((await request(ack,"PATCH",{}, {id:3,role:"Customer"})).status,404);
    assert.equal((await request(ack,"PATCH",{})).status,200);
    assert.equal((await request("/orders/notifications")).data.notifications.length,0);
  } finally {await new Promise(resolve=>server.close(resolve)); db.close();}
});
