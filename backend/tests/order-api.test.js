const {test}=require("node:test");
const assert=require("node:assert/strict");
const express=require("express");
const jwt=require("jsonwebtoken");
const {fixture,customer,admin,body}=require("./fixtures");
const {migrateOrderWorkflow}=require("../services/orderSchema");
process.env.JWT_SECRET="isolated-test-secret-not-for-production";

test("HTTP ordering, authorization, stock adjustments, recipe editing and manual payment verification",async()=>{
  const db=fixture(),app=express();
  app.use(express.json());
  app.use("/api/orders",require("../routes/orders")(db));
  app.use("/api/admin",require("../routes/adminOrders")(db));
  app.use("/api/admin/inventory",require("../routes/inventory")(db));
  const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  const request=async(path,method="GET",payload,user=customer)=>{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{
      method,headers:{"Content-Type":"application/json",...(user?{Authorization:"Bearer "+jwt.sign(user,process.env.JWT_SECRET)}:{})},
      ...(payload===undefined?{}:{body:JSON.stringify(payload)})
    });
    return {status:response.status,data:await response.json()};
  };
  try{
    assert.equal((await request("/orders/my","GET",undefined,null)).status,401);
    assert.equal((await request("/admin/inventory","GET",undefined,customer)).status,403);
    const quote=await request("/orders/quote","POST",body());
    assert.equal(quote.data.total,160);
    const payload=body({payment:"GCash",paymentReference:"0001234567890",paymentStatus:"Verified"});
    const created=await request("/orders","POST",payload);
    assert.equal(created.status,201,JSON.stringify(created.data));
    const id=created.data.orderId;
    assert.equal(created.data.paymentStatus,"Pending verification");
    assert.equal((await request("/orders","POST",payload)).data.orderId,id);
    assert.equal((await request("/orders","POST",body({...payload,requestKey:require("node:crypto").randomUUID()}))).status,409);
    assert.equal((await request("/orders/"+id+"/cancel","PATCH",{},{id:3,role:"Customer"})).status,404);
    assert.equal((await request("/admin/orders/"+id+"/verify-payment","PATCH",{confirmedReceived:true},customer)).status,403);
    assert.equal((await request("/admin/orders/"+id+"/status","PATCH",{status:"Preparing"},admin)).status,409);
    assert.equal((await request("/admin/orders/"+id+"/verify-payment","PATCH",{},admin)).status,400);
    assert.equal((await request("/admin/orders/"+id+"/verify-payment","PATCH",{confirmedReceived:true},admin)).status,200);
    assert.equal((await request("/admin/orders/"+id+"/status","PATCH",{status:"Preparing"},admin)).status,200);
    assert.equal((await request("/orders/my")).data.orders[0].paymentStatus,"Verified");
    const syrup=db.prepare("SELECT * FROM inventory_items WHERE sku='caramel-syrup'").get();
    assert.equal((await request("/admin/inventory/"+syrup.id+"/set-stock","PATCH",{quantity:250},admin)).status,200);
    const inventory=await request("/admin/inventory","GET",undefined,admin);
    assert.equal(inventory.data.items.find(item=>item.id===syrup.id).status,"Low Stock");
    assert.equal((await request("/admin/inventory/"+syrup.id+"/add-stock","PATCH",{amount:750},admin)).status,200);
    assert.equal(db.prepare("SELECT quantity FROM inventory_items WHERE id=?").get(syrup.id).quantity,1000);
    assert.equal((await request("/admin/inventory/"+syrup.id+"/set-stock","PATCH",{quantity:""},admin)).status,400);
    assert.equal((await request("/admin/inventory/"+syrup.id+"/add-stock","PATCH",{amount:-1},admin)).status,400);
    const newStock={sku:"test-supply",productName:"Test supply",category:"Test",quantity:0,measurement:"ml",initialQuantity:750};
    assert.equal((await request("/admin/inventory","POST",newStock,admin)).status,201);
    assert.equal((await request("/admin/inventory","POST",newStock,admin)).status,409);
    assert.equal((await request("/admin/inventory","POST",{...newStock,sku:"invalid",initialQuantity:0},admin)).status,400);
    const recipePath="/admin/inventory/recipes/"+encodeURIComponent("caramel-frappe|16oz");
    assert.equal((await request(recipePath,"PUT",{terms:[{sku:"caramel-syrup",amount:20,unit:"g"}]},admin)).status,400);
    assert.equal((await request(recipePath,"PUT",{terms:[]},admin)).status,400);
    assert.equal((await request(recipePath,"PUT",{terms:[{sku:"caramel-syrup",amount:22,unit:"ml"}]},admin)).status,200);
    migrateOrderWorkflow(db);
    assert.equal(JSON.parse(db.prepare("SELECT terms_json FROM menu_recipes WHERE id='caramel-frappe|16oz'").get().terms_json)[0].amount,22);
    const recipes=await request("/admin/inventory/recipes","GET",undefined,admin);
    assert.ok(recipes.data.recipes.length>45);
    const cancel=await request("/orders/"+id+"/cancel","PATCH",{});
    assert.equal(cancel.data.inventoryState,"consumed");
    assert.equal(cancel.data.refundStatus,"Needs staff review");
    assert.equal((await request("/admin/orders/"+id+"/verify-payment","PATCH",{confirmedReceived:true},admin)).status,400);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    db.close();
  }
});
