// Online pickup orders: the customer collects the order at the store and pays
// there (or prepays by GCash). Isolated test databases only.
const {test}=require("node:test");
const assert=require("node:assert/strict");
const jwt=require("jsonwebtoken");
const {fixture,customer,admin,body}=require("./fixtures");
const {createOrderWorkflow}=require("../services/orderWorkflow");
const {createOrderSafety}=require("../services/orderSafety");
const {createApp}=require("../app");
process.env.JWT_SECRET="isolated-pickup-test-secret";

test("pickup needs no address, follows New > Preparing > Ready for Pickup > Completed and is paid at the store",()=>{
  const db=fixture();
  try {
    const workflow=createOrderWorkflow(db),safety=createOrderSafety(db);
    const notices=require("../services/paymentReview").createPaymentReviewService(db);
    // Delivery still requires an address; pickup does not.
    assert.throws(()=>workflow.create(body({address:""}),customer),/delivery address/);
    const order=workflow.create(body({serviceType:"Pickup",address:""}),customer);
    assert.equal(order.serviceType,"Pickup");
    const row=()=>db.prepare("SELECT * FROM orders WHERE id=?").get(order.orderId);
    assert.equal(row().address,"");
    assert.equal(row().service_type,"Pickup");
    // Riders are not used for pickup.
    assert.throws(()=>require("../services/delivery").createDeliveryService(db).save(order.orderId,{fee:50,trackingUrl:"https://www.lalamove.com/x"},admin),/no rider/);
    workflow.advance(order.orderId,"Preparing",admin);
    assert.throws(()=>workflow.advance(order.orderId,"Out for Delivery",admin),/Invalid order status/);
    assert.equal(workflow.advance(order.orderId,"Ready for Pickup",admin).status,"Ready for Pickup");
    assert.ok(row().pickup_ready_at);
    // The customer is told it is ready and how much to pay at the counter.
    const notice=notices.pending(customer).find(entry=>entry.orderId===order.orderId);
    assert.equal(notice.type,"pickup");
    assert.match(notice.message,/ready for pickup.*72 Villanueva.*Please pay ₱160\.00 at the counter/);
    notices.acknowledgePickup(order.orderId,customer);
    assert.equal(notices.pending(customer).some(entry=>entry.orderId===order.orderId),false);
    const done=workflow.advance(order.orderId,"Completed",admin);
    assert.deepEqual([done.status,done.paymentStatus],["Completed","Paid"]);
  } finally {db.close();}
});

test("pay-at-store has the same limit as cash on delivery; admin can cancel an uncollected pickup",()=>{
  const db=fixture();
  try {
    const workflow=createOrderWorkflow(db);
    const big=[{productId:"caramel-frappe",quantity:10,options:{Size:"16oz"}}];
    const quote=workflow.prepareQuote(body({items:big,serviceType:"Pickup",address:""}));
    assert.equal(quote.cashOnDelivery.allowed,false);
    assert.match(quote.cashOnDelivery.message,/Paying at the store is available for orders up to ₱1,500/);
    assert.throws(()=>workflow.create(body({items:big,expectedTotal:1600,serviceType:"Pickup",address:""}),customer),/Paying at the store/);
    // GCash prepaid pickup is allowed for large orders.
    assert.ok(workflow.create(body({items:big,expectedTotal:1600,serviceType:"Pickup",address:"",payment:"GCash",paymentReference:"1000000000099"}),customer).orderId);
    // A customer who never comes: only an administrator can cancel it once it is ready.
    const order=workflow.create(body({serviceType:"Pickup",address:""}),customer);
    workflow.advance(order.orderId,"Preparing",admin);
    workflow.advance(order.orderId,"Ready for Pickup",admin);
    assert.throws(()=>workflow.cancel(order.orderId,customer),/can no longer be canceled online|Only new or preparing/);
    assert.equal(workflow.cancel(order.orderId,admin).status,"Canceled");
  } finally {db.close();}
});

test("Staff marks a pickup ready, then must confirm pickup and payment to complete it",async()=>{
  const db=fixture();
  db.prepare("INSERT INTO users(id,first_name,last_name,email,password_hash,role) VALUES(5,'Test','Staff','staff@test.invalid','unused','Staff')").run();
  const app=createApp(db);
  const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  const request=async(path,method="GET",data,id=5)=>{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,
      headers:{"Content-Type":"application/json",Authorization:"Bearer "+jwt.sign({id,ver:0},process.env.JWT_SECRET)},
      ...(data===undefined?{}:{body:JSON.stringify(data)})});
    return {status:response.status,data:await response.json()};
  };
  try {
    const order=createOrderWorkflow(db).create(body({serviceType:"Pickup",address:""}),customer);
    const status=next=>request(`/workforce/preparation/${order.orderId}/status`,"PATCH",next);
    // First order with cash: staff confirm with the customer by phone first.
    assert.equal((await status({status:"Preparing",customerConfirmed:true})).status,200);
    assert.equal((await status({status:"Out for Delivery"})).status,403);
    assert.equal((await status({status:"Ready for Pickup"})).status,200);
    const queue=(await request("/workforce/preparation")).data.orders;
    assert.equal(queue.find(row=>row.id===order.orderId).status,"Ready for Pickup");
    assert.equal((await status({status:"Completed"})).status,400);
    const done=await status({status:"Completed",pickupConfirmed:true});
    assert.equal(done.status,200);
    assert.equal(done.data.status,"Completed");
    // The customer sees it as a pickup in My Orders.
    const mine=await request("/orders/my","GET",undefined,1);
    assert.equal(mine.data.orders.find(row=>row.id===order.orderId).serviceType,"Pickup");
  } finally {await new Promise(resolve=>server.close(resolve));db.close();}
});
