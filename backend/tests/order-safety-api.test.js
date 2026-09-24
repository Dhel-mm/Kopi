const {test}=require("node:test");
const assert=require("node:assert/strict");
const express=require("express");
const jwt=require("jsonwebtoken");
const {fixture,customer,admin,body}=require("./fixtures");
process.env.JWT_SECRET="isolated-safety-tests-not-for-production";

async function harness(run) {
  const db=fixture(),app=express();
  app.use(express.json());
  app.use("/api/orders",require("../routes/orders")(db));
  app.use("/api/admin",require("../routes/adminOrders")(db));
  app.use("/api/admin/inventory",require("../routes/inventory")(db));
  const server=await new Promise(resolve=>{
    const listener=app.listen(0,"127.0.0.1",()=>resolve(listener));
  });
  const request=async(path,method="GET",payload,user=customer)=>{
    const response=await fetch("http://127.0.0.1:"+server.address().port+"/api"+path,{
      method,headers:{"Content-Type":"application/json",Authorization:"Bearer "+jwt.sign(user,process.env.JWT_SECRET)},
      ...(payload===undefined?{}:{body:JSON.stringify(payload)})
    });
    return {status:response.status,data:await response.json()};
  };
  try { await run(db,request); }
  finally { await new Promise(resolve=>server.close(resolve)); db.close(); }
}

test("simultaneous online and POS orders cannot oversell the final serving",()=>harness(async(db,request)=>{
  db.prepare("UPDATE inventory_items SET quantity=20 WHERE sku='caramel-syrup'").run();
  const outcomes=await Promise.all([
    request("/orders","POST",body()),
    request("/admin/orders","POST",body({serviceType:"Dine-in"}),admin)
  ]);
  assert.deepEqual(outcomes.map(result=>result.status).sort(),[201,409]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders").get().n,1);
  assert.equal(db.prepare("SELECT quantity FROM inventory_items WHERE sku='caramel-syrup'").get().quantity,0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_items WHERE quantity<0").get().n,0);
}));

test("parallel duplicate requests and cancellations change stock exactly once",()=>harness(async(db,request)=>{
  const before=db.prepare("SELECT quantity FROM inventory_items WHERE sku='caramel-syrup'").get().quantity;
  const payload=body();
  const results=await Promise.all(Array.from({length:6},()=>request("/orders","POST",payload)));
  assert.ok(results.every(result=>result.status===201));
  assert.equal(new Set(results.map(result=>result.data.orderId)).size,1);
  const id=results[0].data.orderId;
  assert.equal(db.prepare("SELECT quantity FROM inventory_items WHERE sku='caramel-syrup'").get().quantity,before-20);
  const cancellations=await Promise.all(Array.from({length:6},()=>request("/orders/"+id+"/cancel","PATCH",{})));
  assert.ok(cancellations.every(result=>result.status===200));
  assert.equal(db.prepare("SELECT quantity FROM inventory_items WHERE sku='caramel-syrup'").get().quantity,before);
  const movements=db.prepare("SELECT change_amount FROM inventory_transactions WHERE inventory_item_id=(SELECT id FROM inventory_items WHERE sku='caramel-syrup') ORDER BY id").all();
  assert.deepEqual(movements.map(row=>row.change_amount),[-20,20]);
}));

test("order recovery is restricted to the owner and original checkout type",()=>harness(async(db,request)=>{
  const payload=body(),created=await request("/orders","POST",payload);
  const endpoint="/orders/requests/"+payload.requestKey;
  assert.equal((await request(endpoint)).data.orderId,created.data.orderId);
  assert.equal((await request(endpoint,"GET",undefined,{id:3,role:"Customer"})).status,404);
  assert.equal((await request("/admin"+endpoint,"GET",undefined,admin)).status,404);
  const invalid=await request("/orders","POST",body({payment:"GCash",paymentReference:"bad-reference"}));
  assert.equal(invalid.status,400);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders").get().n,1);
}));

test("measured conversions require admin confirmation and do not change counted stock",()=>harness(async(db,request)=>{
  const path="/admin/inventory/unit-conversions/caramel-syrup/g";
  const measured={recipeAmount:50,stockAmount:40,confirmedMeasured:true};
  assert.equal((await request(path,"PUT",measured)).status,403);
  assert.equal((await request(path,"PUT",{...measured,confirmedMeasured:false},admin)).status,400);
  assert.equal((await request(path,"PUT",{...measured,stockAmount:0},admin)).status,400);
  assert.equal((await request(path,"PUT",measured,admin)).status,200);
  const conversions=(await request("/admin/inventory/unit-conversions","GET",undefined,admin)).data.conversions;
  const saved=conversions.find(row=>row.sku==="caramel-syrup");
  assert.equal(saved.isEstimate,0);
  assert.equal(saved.recipeUnit,"g");
  assert.equal(saved.stockUnit,"ml");
  assert.equal(saved.stockAmount,40);
  assert.equal(db.prepare("SELECT quantity FROM inventory_items WHERE sku='caramel-syrup'").get().quantity,100000);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_transactions").get().n,0);
}));

test("low-stock boundary follows one-quarter packages and the three special products",()=>harness(async(db,request)=>{
  db.prepare("INSERT INTO inventory_items(sku,product_name,category,quantity,measurement,initial_quantity,low_stock_level) VALUES('sugar','Sugar','Test',250,'g',250,250)").run();
  for(const sku of ["caramel-syrup","sugar","condensed-milk","sprite"]) {
    const item=db.prepare("SELECT * FROM inventory_items WHERE sku=?").get(sku);
    const threshold=item.initial_quantity*(sku==="caramel-syrup"?0.25:1);
    for(const [amount,status] of [[0,"Out of Stock"],[threshold,"Low Stock"],[threshold+0.001,"In Stock"]]) {
      assert.equal((await request("/admin/inventory/"+item.id+"/set-stock","PATCH",{quantity:amount},admin)).status,200);
      const inventory=(await request("/admin/inventory","GET",undefined,admin)).data.items;
      assert.equal(inventory.find(row=>row.id===item.id).status,status,sku+" at "+amount);
    }
  }
}));
