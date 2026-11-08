const {test}=require("node:test");
const assert=require("node:assert/strict");
const jwt=require("jsonwebtoken");
const bcrypt=require("bcryptjs");
const {fixture,body}=require("./fixtures");
const {createApp}=require("../app");
process.env.JWT_SECRET="isolated-workforce-test-secret";

async function harness(run) {
  const db=fixture();
  db.prepare(`INSERT INTO users(id,first_name,last_name,email,password_hash,role)
    VALUES(4,'Test','Cashier','cashier@test.invalid','unused','Cashier'),
    (5,'Test','Staff','staff@test.invalid','unused','Staff')`).run();
  const app=createApp(db);
  const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(path,method="GET",data,id=4,claims={})=>{
    const response=await fetch(base+"/api"+path,{method,headers:{"Content-Type":"application/json",
      ...(id?{Authorization:"Bearer "+jwt.sign({id,ver:0,...claims},process.env.JWT_SECRET)}:{})},
      ...(data===undefined?{}:{body:JSON.stringify(data)})});
    return {status:response.status,data:await response.json()};
  };
  try {await run({db,request,base});}
  finally {await new Promise(resolve=>server.close(resolve));db.close();}
}

test("employee workspaces are served but API access requires stored Cashier/Staff roles",async()=>harness(async({request,base})=>{
  for(const path of ["/Cashier/Orders.html","/Cashier/History.html","/Cashier/Verify.html","/Cashier/Inventory.html","/Staff/Orders.html","/Staff/Inventory.html"]) {
    assert.equal((await fetch(base+path)).status,200,path);
  }
  assert.equal((await request("/workforce/orders","GET",undefined,null)).status,401);
  assert.equal((await request("/workforce/orders","GET",undefined,1,{role:"Cashier"})).status,403);
  assert.equal((await request("/workforce/orders","GET",undefined,5)).status,403);
  assert.equal((await request("/workforce/preparation","GET",undefined,4)).status,403);
  assert.equal((await request("/workforce/stock","GET",undefined,4)).status,200);
  assert.equal((await request("/workforce/verifications","GET",undefined,4)).status,200);
  assert.equal((await request("/workforce/verifications","GET",undefined,5)).status,403);
  assert.equal((await request("/workforce/verifications","GET",undefined,1)).status,403);
  for (const id of [4,5]) {
    for(const path of ["/admin/orders","/admin/users","/admin/inventory","/admin/dashboard","/admin/vouchers"]) {
      assert.equal((await request(path,"GET",undefined,id,{role:"Admin"})).status,403,path);
    }
    assert.equal((await request("/orders","POST",body(),id)).status,403);
  }
}));

test("Cashier uses server pricing, vouchers, stock and idempotent recovery; Staff completes the same POS order",async()=>harness(async({db,request})=>{
  const payload=body({serviceType:"Dine-in",customerName:"Walk-in test"});
  assert.equal((await request("/workforce/orders/quote","POST",payload)).data.total,160);
  assert.equal((await request("/workforce/orders","POST",payload,5)).status,403);
  assert.equal((await request("/workforce/orders","POST",{...payload,payment:"Other"})).status,400);
  const created=await request("/workforce/orders","POST",payload);
  assert.equal(created.status,201,JSON.stringify(created.data));
  const id=created.data.orderId;
  const movements=db.prepare("SELECT COUNT(*) AS n FROM inventory_transactions WHERE order_id=?").get(id).n;
  assert.ok(movements>0);
  assert.equal((await request("/workforce/orders","POST",payload)).data.orderId,id);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_transactions WHERE order_id=?").get(id).n,movements);
  assert.equal((await request("/workforce/orders/requests/"+payload.requestKey)).data.orderId,id);
  assert.equal((await request("/workforce/orders/requests/"+payload.requestKey,"GET",undefined,2)).status,403);
  assert.equal((await request("/workforce/orders/"+id)).data.order.items[0].price,160);
  assert.equal((await request("/workforce/orders")).data.orders.length,1);
  const prepared=await request(`/workforce/preparation/${id}/status`,"PATCH",{status:"Completed"},5);
  assert.equal(prepared.status,200,JSON.stringify(prepared.data));
  assert.equal(prepared.data.status,"Completed");
  assert.equal((await request("/workforce/preparation","GET",undefined,5)).data.orders.length,0);
  assert.equal((await request(`/workforce/preparation/${id}/status`,"PATCH",{status:"Completed"},5)).status,200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_transactions WHERE order_id=?").get(id).n,movements);
}));

test("Cashier availability follows inventory and selected products still require current stock",async()=>harness(async({db,request})=>{
  for (const id of [null,1,2,5]) {
    assert.equal((await request("/workforce/orders/availability","GET",undefined,id)).status,id===null?401:403);
  }
  const get=async()=> (await request("/workforce/orders/availability?serviceType=Dine-in")).data.products;
  assert.equal((await get()).find(p=>p.productId==="caramel-frappe").available,true);
  db.prepare("UPDATE inventory_items SET quantity=0 WHERE sku='caramel-syrup'").run();
  assert.equal((await get()).find(p=>p.productId==="caramel-frappe").available,false);
  assert.equal((await request("/workforce/orders/quote","POST",body({serviceType:"Dine-in"}))).status,409);
  assert.equal((await request("/workforce/orders","POST",body({serviceType:"Dine-in"}))).status,409);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders").get().n,0);
  db.prepare("UPDATE inventory_items SET quantity=100000 WHERE sku='caramel-syrup'").run();
  assert.equal((await get()).find(p=>p.productId==="caramel-frappe").available,true);
  assert.equal((await request("/workforce/orders/availability?serviceType=invalid")).status,400);
}));

test("Staff receives delivery details and completes verified GCash delivery only after handover and confirmation",async()=>harness(async({db,request})=>{
  const online=await request("/orders","POST",body({payment:"GCash",paymentReference:"1234567890123"}),1);
  assert.equal(online.status,201);
  const id=online.data.orderId,path=`/workforce/preparation/${id}/status`;
  const listed=(await request("/workforce/preparation","GET",undefined,5)).data.orders[0];
  assert.ok(listed.items.length);
  for(const key of ["phone","address","paymentReference","total"])assert.notEqual(listed[key],undefined,key);
  assert.equal(listed.email,undefined);
  assert.equal(listed.items[0].price,undefined);
  assert.equal((await request("/workforce/orders/"+id)).status,404);
  assert.equal((await request(path,"PATCH",{status:"Preparing"},5)).status,409);
  assert.equal((await request(path,"PATCH",{status:"Completed"},5)).status,403);
  assert.equal((await request(`/admin/orders/${id}/verify-payment`,"PATCH",{confirmedReceived:true},5)).status,403);
  // The Cashier confirms GCash from the verification page; Staff and Customers cannot.
  const verify=`/workforce/verifications/${id}/verify-payment`;
  assert.equal((await request(verify,"PATCH",{confirmedReceived:true},5)).status,403);
  assert.equal((await request(`/workforce/preparation/${id}/verify-payment`,"PATCH",{confirmedReceived:true},5)).status,404);
  assert.equal((await request(`/workforce/verifications/${id}/payment-proof`,"GET",undefined,5)).status,403);
  assert.equal((await request(verify,"PATCH",{confirmedReceived:true},1)).status,403);
  assert.equal((await request(verify,"PATCH",{},4)).status,400);
  assert.equal((await request(`/workforce/verifications/${id}/payment-proof`,"GET",undefined,4)).status,200);
  assert.ok((await request("/workforce/verifications","GET",undefined,4)).data.orders.some(order=>order.id===id));
  assert.equal(db.prepare("SELECT payment_status FROM orders WHERE id=?").get(id).payment_status,"Pending verification");
  const verified=await request(verify,"PATCH",{confirmedReceived:true},4);
  assert.equal(verified.status,200,JSON.stringify(verified.data));
  assert.deepEqual({...db.prepare("SELECT payment_status,payment_verified_by FROM orders WHERE id=?").get(id)},{payment_status:"Verified",payment_verified_by:4});
  assert.equal((await request(verify,"PATCH",{confirmedReceived:true},4)).status,200);
  assert.equal((await request(`/admin/orders/${id}/verify-payment`,"PATCH",{confirmedReceived:true},2)).status,200);
  assert.equal((await request(path,"PATCH",{status:"Preparing"},5)).status,200);
  assert.equal((await request(path,"PATCH",{status:"Completed",deliveryConfirmed:true},5)).status,403);
  assert.equal((await request(path,"PATCH",{status:"Canceled"},5)).status,403);
  assert.equal((await request(`/workforce/preparation/${id}/delivery`,"PUT",{fee:80,trackingUrl:"https://share.lalamove.com/?demo=kopi-calamba",revision:0},5)).status,200);
  assert.equal((await request(path,"PATCH",{status:"Out for Delivery"},5)).status,200);
  assert.equal((await request(path,"PATCH",{status:"Arrived"},5)).status,403);
  assert.equal((await request("/orders/my","GET",undefined,1)).data.orders[0].status,"Out for Delivery");
  assert.ok((await request("/workforce/preparation","GET",undefined,5)).data.orders.some(order=>order.id===id));
  assert.equal((await request(path,"PATCH",{status:"Completed"},5)).status,400);
  assert.equal((await request(path,"PATCH",{status:"Completed",deliveryConfirmed:true},4)).status,403);
  const movements=db.prepare("SELECT COUNT(*) AS n FROM inventory_transactions WHERE order_id=?").get(id).n;
  const completed=await request(path,"PATCH",{status:"Completed",deliveryConfirmed:true},5);
  assert.equal(completed.status,200,JSON.stringify(completed.data));
  assert.equal(completed.data.status,"Completed");
  const completedAt=db.prepare("SELECT completed_at FROM orders WHERE id=?").get(id).completed_at;
  assert.ok(completedAt);
  assert.equal((await request("/orders/my","GET",undefined,1)).data.orders[0].status,"Completed");
  assert.ok(!(await request("/workforce/preparation","GET",undefined,5)).data.orders.some(order=>order.id===id));
  assert.equal((await request(path,"PATCH",{status:"Completed",deliveryConfirmed:true},5)).status,200);
  assert.equal(db.prepare("SELECT completed_at FROM orders WHERE id=?").get(id).completed_at,completedAt);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_transactions WHERE order_id=?").get(id).n,movements);
  assert.equal((await request(path,"PATCH",{status:"Preparing"},5)).status,403);
}));

test("Staff confirms Cash delivery, including older orders already marked Arrived",async()=>harness(async({db,request})=>{
  for(const arrived of [false,true]) {
    const created=await request("/orders","POST",body(),1);
    assert.equal(created.status,201);
    const id=created.data.orderId,path=`/workforce/preparation/${id}/status`;
    // The customer's first cash order is flagged: staff confirm it with the customer
    // first. After a completed order, the next small cash order is not flagged.
    if(!arrived) assert.equal((await request(path,"PATCH",{status:"Preparing"},5)).status,409);
    assert.equal((await request(path,"PATCH",{status:"Preparing",...(arrived?{}:{customerConfirmed:true})},5)).status,200);
    assert.equal((await request(path,"PATCH",{status:"Out for Delivery"},5)).status,200);
    if(arrived) db.prepare("UPDATE orders SET status='Arrived' WHERE id=?").run(id);
    assert.ok((await request("/workforce/preparation","GET",undefined,5)).data.orders.some(order=>order.id===id));
    assert.equal((await request(path,"PATCH",{status:"Completed",deliveryConfirmed:false},5)).status,400);
    assert.equal((await request(path,"PATCH",{status:"Completed",deliveryConfirmed:true},5)).status,200);
  }
}));

test("Cashier sees the same read-only stock as Staff",async()=>harness(async({request})=>{
  const result=await request("/workforce/stock","GET",undefined,4);
  assert.equal(result.status,200);
  assert.ok(result.data.items.length>0);
  assert.ok(result.data.items.every(row=>row.status&&row.reorderLevel!==undefined));
  assert.equal((await request("/admin/inventory","GET",undefined,4)).status,403);
}));

test("Staff stock is read-only, excludes archived products and matches special low-stock rules",async()=>harness(async({db,request})=>{
  db.prepare(`INSERT INTO inventory_items(sku,product_name,category,quantity,measurement,initial_quantity,low_stock_level)
    VALUES('sugar','Sugar','Sweeteners',500,'g',1000,1000)
    ON CONFLICT(sku) DO UPDATE SET quantity=500,initial_quantity=1000,is_archived=0`).run();
  const syrup=db.prepare("SELECT id FROM inventory_items WHERE sku='caramel-syrup'").get();
  db.prepare("UPDATE inventory_items SET is_archived=1 WHERE id=?").run(syrup.id);
  const result=await request("/workforce/stock","GET",undefined,5);
  assert.equal(result.status,200);
  assert.equal(result.data.items.find(row=>row.productName==="Sugar").status,"Low Stock");
  assert.ok(!result.data.items.some(row=>row.id===syrup.id));
  assert.equal((await request("/workforce/stock","POST",{quantity:999},5)).status,404);
  assert.equal((await request(`/admin/inventory/${syrup.id}/set-stock`,"PATCH",{quantity:1000},5)).status,403);
}));

test("Admin can provision employee accounts and demotion/inactivation revokes employee access",async()=>harness(async({db,request,base})=>{
  const password="Isolated-test-password-2026";
  db.prepare("UPDATE users SET password_hash=? WHERE id=2").run(await bcrypt.hash(password,4));
  for(const role of ["Cashier","Staff"]) {
    const created=await request("/admin/users","POST",{firstName:"Demo",lastName:role,
      email:role.toLowerCase()+".new@test.invalid",currentPassword:password,role},2);
    assert.equal(created.status,201,JSON.stringify(created.data));
    // No email service in tests, so the temporary password is shown once to the admin.
    assert.equal(created.data.emailSent,false);
    assert.match(created.data.temporaryPassword,/^[A-Za-z2-9]{12}$/);
    const email=role.toLowerCase()+".new@test.invalid";
    const login=await request("/auth/login","POST",{email,password:created.data.temporaryPassword},null);
    assert.equal(login.status,200);assert.equal(login.data.user.role,role);
    assert.equal(login.data.user.mustChangePassword,true);
    // Nothing else works until the temporary password is replaced.
    let token=login.data.token;
    const send=async(path,method,data)=>{
      const response=await fetch(base+"/api"+path,{method,headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},...(data?{body:JSON.stringify(data)}:{})});
      return {status:response.status,data:await response.json()};
    };
    const blocked=await send("/workforce/stock","GET");
    assert.equal(blocked.status,403);assert.equal(blocked.data.mustChangePassword,true);
    assert.equal((await send("/me","GET")).data.user.mustChangePassword,true);
    assert.equal((await send("/me/password","PATCH",{currentPassword:created.data.temporaryPassword,newPassword:created.data.temporaryPassword})).status,400);
    const changed=await send("/me/password","PATCH",{currentPassword:created.data.temporaryPassword,newPassword:"my-own-pass"});
    assert.equal(changed.status,200,JSON.stringify(changed.data));
    assert.equal(changed.data.user.mustChangePassword,false);
    token=changed.data.token;
    assert.equal((await send("/workforce/stock","GET")).status,200);
    assert.equal((await request("/auth/login","POST",{email,password:created.data.temporaryPassword},null)).status,401);
    // A new temporary password replaces a forgotten one, for employees only.
    const id=created.data.id;
    assert.equal((await request(`/admin/users/${id}/temporary-password`,"POST",{currentPassword:"wrong"},2)).status,400);
    const again=await request(`/admin/users/${id}/temporary-password`,"POST",{currentPassword:password},2);
    assert.equal(again.status,200);
    assert.equal((await request("/auth/login","POST",{email,password:"my-own-pass"},null)).status,401);
    db.prepare("UPDATE users SET temp_password_expires_at=1 WHERE id=?").run(id);
    assert.match((await request("/auth/login","POST",{email,password:again.data.temporaryPassword},null)).data.message,/expired/);
  }
  assert.equal((await request("/admin/users/1/temporary-password","POST",{currentPassword:password},2)).status,400);
  assert.equal((await request("/admin/users/4","PATCH",{role:"Staff",status:"Active",currentPassword:password},2)).status,200);
  assert.equal((await request("/workforce/orders")).status,401);
  assert.equal((await request("/workforce/preparation","GET",undefined,4,{ver:1})).status,200);
  db.prepare("UPDATE users SET status='Inactive' WHERE id=5").run();
  assert.equal((await request("/workforce/preparation","GET",undefined,5)).status,401);
}));
