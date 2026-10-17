const {test}=require("node:test");
const assert=require("node:assert/strict");
const express=require("express");
const jwt=require("jsonwebtoken");
const {fixture,customer,admin,body}=require("./fixtures");
const {packageDefinition,packageLabel}=require("../services/inventoryPackages");
const {createOrderWorkflow}=require("../services/orderWorkflow");
process.env.JWT_SECRET="isolated-inventory-packages-test-secret";
const definition=(overrides={})=>({recipeAmount:1,recipeUnit:"L",stockAmount:1,stockUnit:"bottle",confirmedMeasured:true,...overrides});

test("package definitions normalize L/kg to the ingredient unit and accept owner stock labels",()=>{
  for(const [unit,measurement,amount,count,capacity] of [
    ["L","ml",1,1,1000],["ml","ml",1000,1,1000],
    ["kg","g",2,4,500],["g","g",500,1,500],["pcs","pcs",50,1,50]
  ]) {
    assert.deepEqual(packageDefinition({measurement},definition({recipeUnit:unit,recipeAmount:amount,stockAmount:count,stockUnit:"sachet"})),{capacity,label:"sachet"});
  }
  assert.equal(packageLabel("  refill   bottle  "),"refill bottle");
  assert.equal(packageLabel("supot"),"supot");
  for(const stockUnit of ["", " ", "<img onerror=alert(1)>", "x".repeat(41),42]) {
    assert.throws(()=>packageDefinition({measurement:"ml"},definition({stockUnit})),/stock unit/);
  }
  for(const stockAmount of [0,-1,1.5,"1",NaN]) assert.throws(()=>packageDefinition({measurement:"ml"},definition({stockAmount})),/whole number/);
  for(const recipeAmount of [0,-1,null,"1",Infinity]) assert.throws(()=>packageDefinition({measurement:"ml"},definition({recipeAmount})),/recipe amount/);
  assert.throws(()=>packageDefinition({measurement:"ml"},definition({recipeUnit:"kg"})),/L or ml/);
  assert.throws(()=>packageDefinition({measurement:"ml"},definition({recipeUnit:"unknown"})),/Choose/);
  assert.throws(()=>packageDefinition({measurement:"ml"},definition({confirmedMeasured:false})),/Confirm/);
  assert.throws(()=>packageDefinition({measurement:"ml"},definition({stockAmount:3})),/measurable amount/);
});

test("Admin can save package sizes without changing remaining stock, recipes, movements or cancellation amounts",async()=>{
  const db=fixture(),app=express();
  app.use(express.json());app.use("/inventory",require("../routes/inventory")(db));
  const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  const request=async(route,method="GET",payload,user=admin)=>{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/inventory${route}`,{
      method,headers:{"Content-Type":"application/json",Authorization:"Bearer "+jwt.sign(user,process.env.JWT_SECRET)},
      ...(payload===undefined?{}:{body:JSON.stringify(payload)})});
    return {status:response.status,data:await response.json()};
  };
  try {
    db.prepare("UPDATE inventory_items SET quantity=840,initial_quantity=1000 WHERE sku='oat-milk'").run();
    const originalConversions=db.prepare("SELECT * FROM inventory_unit_conversions").all();
    const recipes=db.prepare("SELECT * FROM menu_recipes").all();
    assert.equal((await request("/package-conversion/oat-milk","PUT",definition(),customer)).status,403);
    assert.equal((await request("/package-conversion/missing","PUT",definition())).status,404);
    assert.equal((await request("/package-conversion/oat-milk","PUT",definition({stockAmount:0}))).status,400);
    const saved=await request("/package-conversion/oat-milk","PUT",definition({stockUnit:"refill bottle"}));
    assert.equal(saved.status,200,JSON.stringify(saved.data));
    const milk=(await request("")).data.items.find(item=>item.sku==="oat-milk");
    assert.equal(milk.quantity,840);assert.equal(milk.measurement,"ml");
    assert.equal(milk.initialQuantity,1000);assert.equal(milk.packageUnit,"refill bottle");
    assert.equal(milk.lowStockLevel,250);
    assert.deepEqual(db.prepare("SELECT * FROM menu_recipes").all(),recipes);
    assert.deepEqual(db.prepare("SELECT * FROM inventory_unit_conversions").all(),originalConversions);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_transactions").get().n,0);

    const workflow=createOrderWorkflow(db),created=workflow.create(body(),customer);
    const measured=db.prepare("SELECT quantity FROM inventory_items WHERE sku='oat-milk'").get().quantity;
    const allocations=db.prepare("SELECT * FROM order_stock_allocations").all();
    const movements=db.prepare("SELECT * FROM inventory_transactions").all();
    assert.equal((await request("/package-conversion/oat-milk","PUT",definition({recipeAmount:0.5,stockUnit:"pouch"}))).status,200);
    assert.equal(db.prepare("SELECT quantity FROM inventory_items WHERE sku='oat-milk'").get().quantity,measured);
    assert.deepEqual(db.prepare("SELECT * FROM order_stock_allocations").all(),allocations);
    assert.deepEqual(db.prepare("SELECT * FROM inventory_transactions").all(),movements);
    workflow.cancel(created.orderId,customer);
    assert.equal(db.prepare("SELECT quantity FROM inventory_items WHERE sku='oat-milk'").get().quantity,840);

    assert.equal((await request("/package-conversion/sprite","PUT",definition({recipeAmount:1.5}))).status,200);
    assert.equal((await request("")).data.items.find(item=>item.sku==="sprite").lowStockLevel,1500);
    const added=await request("","POST",{sku:"test-custom-pack",productName:"Test custom pack",category:"Test",quantity:1000,initialQuantity:500,measurement:"g",packageUnit:"sachet"});
    assert.equal(added.status,201,JSON.stringify(added.data));
    assert.equal((await request("")).data.items.find(item=>item.sku==="test-custom-pack").packageUnit,"sachet");
  } finally {await new Promise(resolve=>server.close(resolve));db.close();}
});
