const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {fixture,body,customer,admin}=require("./fixtures");
const {seedInventorySetup,extraIngredients}=require("../services/inventorySetup");
const defaults=require("../services/recipeDefaults");
const {quote,catalog}=require("../services/pricing");
const {createInventoryService}=require("../services/inventory");
const {createOrderWorkflow}=require("../services/orderWorkflow");

function shopFixture() {
  const db=fixture();
  const source=fs.readFileSync(path.join(__dirname,"../../Admin/InventoryData.js"),"utf8");
  const rows=JSON.parse("["+source.match(/const catalog = \[([\s\S]*?)\]\.map/)[1]+"]");
  for (const [sku,name,category,pack,unit] of rows) {
    const stockUnit=sku==="chicken-wings"?"g":unit;
    db.prepare(`INSERT INTO inventory_items(sku,product_name,category,quantity,measurement,initial_quantity,low_stock_level)
      VALUES(?,?,?,100000,?,?,?) ON CONFLICT(sku) DO UPDATE SET measurement=excluded.measurement,quantity=100000`)
      .run(sku,name,category,stockUnit,pack,pack/4);
  }
  for(const recipe of defaults) db.prepare("UPDATE menu_recipes SET terms_json=? WHERE id=?").run(JSON.stringify(recipe.terms),recipe.id);
  seedInventorySetup(db);
  return db;
}

test("all menu variants and modifiers resolve against the shop's actual stock units",()=>{
  const db=shopFixture(),inventory=createInventoryService(db);
  try {
    assert.deepEqual(inventory.recipes().filter(row=>row.issues.length),[]);
    for(const product of catalog.products) for(const variant of Object.keys(product.prices)) {
      const size=product.options.find(option=>option.priceKey);
      const base=size?{[size.label]:variant}:{};
      const addons=product.options.find(option=>option.addOnPrice)?.values||[];
      const flavors=product.options.find(option=>option.key==="flavor")?.values||[];
      for(const selected of [{},...addons.map(value=>({"Add-ons (worth ₱30)":value})),...flavors.map(value=>({Flavors:value}))]) {
        const items=quote(body({items:[{productId:product.id,quantity:1,options:{...base,...selected}}]})).items;
        assert.ok(inventory.check(items,true).length,product.id);
      }
    }
  }finally{db.close();}
});

test("starter conversions deduct correct units and cancellation returns the exact stored amounts",()=>{
  const db=shopFixture(),workflow=createOrderWorkflow(db);
  try {
    const before=db.prepare("SELECT quantity FROM inventory_items WHERE sku='chicken-wings'").get().quantity;
    const payload=body({items:[{productId:"chicken-wings",quantity:2,options:{Pieces:"12pcs",Flavors:"Garlic Parmesan"}}],expectedTotal:740});
    const order=workflow.create(payload,customer);
    assert.equal(db.prepare("SELECT quantity FROM inventory_items WHERE sku='chicken-wings'").get().quantity,before-1200);
    const usage=db.prepare("SELECT a.amount FROM order_stock_allocations a JOIN inventory_items i ON i.id=a.inventory_item_id WHERE a.order_id=? AND i.sku='garlic-parmesan'").get(order.orderId);
    assert.equal(usage.amount,80);
    // Later recipe/conversion edits cannot change what this cancellation returns.
    db.prepare("UPDATE inventory_unit_conversions SET stock_amount=65 WHERE inventory_item_id=(SELECT id FROM inventory_items WHERE sku='chicken-wings')").run();
    workflow.cancel(order.orderId,customer);
    workflow.cancel(order.orderId,admin);
    assert.equal(db.prepare("SELECT quantity FROM inventory_items WHERE sku='chicken-wings'").get().quantity,before);
  }finally{db.close();}
});

test("setup never invents starting stock or overwrite counts or measured conversions",()=>{
  const db=shopFixture();
  try {
    db.prepare("DELETE FROM inventory_items WHERE sku='oat-milk'").run();
    db.prepare("UPDATE inventory_items SET quantity=123 WHERE sku='fresh-milk'").run();
    db.prepare("UPDATE inventory_unit_conversions SET stock_amount=48,is_estimate=0 WHERE inventory_item_id=(SELECT id FROM inventory_items WHERE sku='chicken-wings')").run();
    seedInventorySetup(db);seedInventorySetup(db);
    assert.equal(db.prepare("SELECT quantity FROM inventory_items WHERE sku='oat-milk'").get().quantity,0);
    assert.equal(db.prepare("SELECT quantity FROM inventory_items WHERE sku='fresh-milk'").get().quantity,123);
    const conversion=db.prepare("SELECT stock_amount,is_estimate FROM inventory_unit_conversions WHERE inventory_item_id=(SELECT id FROM inventory_items WHERE sku='chicken-wings')").get();
    assert.deepEqual(conversion,{stock_amount:48,is_estimate:0});
    assert.equal(extraIngredients.length,7);
  }finally{db.close();}
});

test("a retry after menu price changes recovers the original order without deducting again",()=>{
  const db=shopFixture(),workflow=createOrderWorkflow(db),product=catalog.findProduct("caramel-frappe");
  const original=product.prices["16oz"];
  try {
    const request=body(),saved=workflow.create(request,customer);
    product.prices["16oz"]=original+20;
    const before=db.prepare("SELECT COUNT(*) AS n FROM inventory_transactions").get().n;
    assert.equal(workflow.create(request,customer).orderId,saved.orderId);
    assert.equal(workflow.recover(request.requestKey,customer).total,original);
    assert.throws(()=>workflow.recover(request.requestKey,{id:3,role:"Customer"}),/No saved/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_transactions").get().n,before);
  }finally{product.prices["16oz"]=original;db.close();}
});

test("a mid-write failure rolls back the order, allocations, movements and every ingredient",()=>{
  const db=shopFixture(),workflow=createOrderWorkflow(db);
  try {
    const before=db.prepare("SELECT sku,quantity FROM inventory_items ORDER BY sku").all();
    db.exec("CREATE TRIGGER fail_movement BEFORE INSERT ON inventory_transactions BEGIN SELECT RAISE(ABORT,'test failure'); END");
    assert.throws(()=>workflow.create(body(),customer),/test failure/);
    assert.deepEqual(db.prepare("SELECT sku,quantity FROM inventory_items ORDER BY sku").all(),before);
    for(const table of ["orders","order_items","order_stock_allocations","inventory_transactions"]) assert.equal(db.prepare("SELECT COUNT(*) AS n FROM "+table).get().n,0);
  }finally{db.close();}
});

module.exports={shopFixture};
