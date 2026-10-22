const {test}=require("node:test");
const assert=require("node:assert/strict");
const {fixture,body,customer,admin}=require("./fixtures");
const {createOrderWorkflow}=require("../services/orderWorkflow");
const {migrateOrderWorkflow}=require("../services/orderSchema");

test("counter cash is paid after valid tender, while COD is paid only on completion",()=>{
  const db=fixture();
  try {
    const flow=createOrderWorkflow(db);
    const pos=flow.create(body({serviceType:"Dine-in",cashTendered:500}),admin,true);
    assert.equal(pos.paymentStatus,"Paid");
    assert.equal(pos.cashChange,340);
    const online=flow.create(body(),customer);
    assert.equal(online.paymentStatus,"Unpaid");
    assert.equal(flow.advance(online.orderId,"Preparing",admin).paymentStatus,"Unpaid");
    flow.advance(online.orderId,"Out for Delivery",admin);
    assert.equal(flow.advance(online.orderId,"Completed",admin,{deliveryConfirmed:true}).paymentStatus,"Paid");
    assert.equal(flow.advance(pos.orderId,"Completed",admin).paymentStatus,"Paid");
    const unpaid=flow.create(body(),customer);
    assert.equal(flow.cancel(unpaid.orderId,customer).paymentStatus,"Unpaid");
    assert.throws(()=>flow.create(body({serviceType:"Dine-in",cashTendered:1}),admin,true),/cover/);
  } finally {db.close();}
});

test("legacy receipt repair marks only evidenced cash as paid and leaves GCash verification intact",()=>{
  const db=fixture();
  try {
    const flow=createOrderWorkflow(db);
    const completed=flow.create(body(),customer);
    const pending=flow.create(body(),customer);
    const pos=flow.create(body({serviceType:"Dine-in"}),admin,true);
    const gcash=flow.create(body({payment:"GCash",paymentReference:"1234567891234"}),customer);
    db.prepare("UPDATE orders SET status='Completed' WHERE id=?").run(completed.orderId);
    db.prepare("UPDATE orders SET payment_status='Unpaid' WHERE id=?").run(pos.orderId);
    migrateOrderWorkflow(db); migrateOrderWorkflow(db);
    assert.equal(flow.result(completed.orderId).paymentStatus,"Paid");
    assert.equal(flow.result(pos.orderId).paymentStatus,"Paid");
    assert.equal(flow.result(pending.orderId).paymentStatus,"Unpaid");
    assert.equal(flow.result(gcash.orderId).paymentStatus,"Pending verification");
  } finally {db.close();}
});
