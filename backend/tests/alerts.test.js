// Pop-up alerts: Staff hear about new online orders; Admin hears about GCash
// payments and Senior Citizen / PWD IDs to verify. Isolated test databases only.
const {test}=require("node:test");
const assert=require("node:assert/strict");
const jwt=require("jsonwebtoken");
const {fixture,customer,admin,body}=require("./fixtures");
const {createOrderWorkflow}=require("../services/orderWorkflow");
const {createAlertService}=require("../services/alerts");
const {createApp}=require("../app");
process.env.JWT_SECRET="isolated-alerts-test-secret";

test("staff are alerted to new online and walk-in orders; admin to pending GCash payments and IDs",()=>{
  const db=fixture();
  try {
    const flow=createOrderWorkflow(db);
    const alerts=createAlertService(db);
    const cash=flow.create(body(),customer);
    const pickup=flow.create(body({serviceType:"Pickup",address:""}),customer);
    const gcash=flow.create(body({payment:"GCash",paymentReference:"7654321098765"}),customer);
    const walkIn=flow.create({...body({serviceType:"Takeout"}),address:"",phone:""},admin,true);
    // Walk-in orders from the cashier start as Preparing and also alert Staff.
    assert.deepEqual(alerts.staff().orders.map(order=>order.id),[cash.orderId,pickup.orderId,gcash.orderId,walkIn.orderId]);
    assert.deepEqual(alerts.staff().orders.at(-1).orderType,"In-store");
    flow.advance(walkIn.orderId,"Completed",admin);
    assert.equal(alerts.staff().orders[1].serviceType,"Pickup");
    // Once staff start preparing, the order is no longer new.
    flow.advance(cash.orderId,"Preparing",admin);
    assert.equal(alerts.staff().orders.some(order=>order.id===cash.orderId),false);

    assert.deepEqual(alerts.admin().orders.map(order=>[order.id,order.needs]),[[gcash.orderId,["GCash payment"]]]);
    db.prepare("UPDATE orders SET special_discount_type='PWD',special_discount_status='Pending verification' WHERE id=?").run(pickup.orderId);
    assert.deepEqual(alerts.admin().orders.map(order=>[order.id,order.needs]),[[pickup.orderId,["PWD ID"]],[gcash.orderId,["GCash payment"]]]);
    // Verified or canceled orders drop out of the alert.
    db.prepare("UPDATE orders SET payment_status='Verified' WHERE id=?").run(gcash.orderId);
    flow.cancel(pickup.orderId,admin);
    assert.deepEqual(alerts.admin().orders,[]);
  } finally {db.close();}
});

test("alert lists are only available to the right roles",async()=>{
  const db=fixture();
  db.prepare(`INSERT INTO users(id,first_name,last_name,email,password_hash,role)
    VALUES(4,'Test','Cashier','cashier@test.invalid','unused','Cashier'),(5,'Test','Staff','staff@test.invalid','unused','Staff')`).run();
  const server=await new Promise(resolve=>{const s=createApp(db).listen(0,"127.0.0.1",()=>resolve(s));});
  const status=async(path,id)=>(await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,
    {headers:{Authorization:"Bearer "+jwt.sign({id,ver:0},process.env.JWT_SECRET)}})).status;
  try {
    assert.equal(await status("/workforce/alerts",5),200);
    assert.equal(await status("/workforce/alerts",2),200);
    assert.equal(await status("/workforce/alerts",4),403);
    assert.equal(await status("/workforce/alerts",1),403);
    assert.equal(await status("/admin/alerts",2),200);
    assert.equal(await status("/admin/alerts",5),403);
    assert.equal(await status("/admin/alerts",1),403);
  } finally {await new Promise(resolve=>server.close(resolve));db.close();}
});
