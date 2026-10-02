const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {fixture,body,customer}=require("./fixtures");
const {items,applyInventoryCatalog}=require("../services/inventoryCatalog");
const {createOrderWorkflow}=require("../services/orderWorkflow");
const {createInventoryService,lowStockLevel}=require("../services/inventory");
const {createReports}=require("../services/reports");
const stock=(db,sku)=>db.prepare("SELECT * FROM inventory_items WHERE sku=?").get(sku);

test("CSV imports all 56 products, bottle sizes, and categories once without erasing extra supplies",()=>{
  const db=fixture();
  try {
    const straws=stock(db,"straws").quantity;
    assert.equal(applyInventoryCatalog(db),true);
    assert.equal(items.length,56);
    assert.equal(new Set(items.map(item=>item.sku)).size,56);
    for(const item of items) {
      const saved=stock(db,item.sku);
      assert.equal(saved.product_name,item.productName);
      assert.equal(saved.category,item.category);
      assert.equal(saved.quantity,item.quantity);
      assert.equal(saved.initial_quantity,item.packageQuantity);
      assert.equal(saved.measurement,item.measurement);
      assert.equal(saved.package_unit,item.packageUnit);
    }
    for(const [sku,quantity] of [["oat-milk",20000],["sprite",20000],["cooking-oil",10000]]) {
      const saved=stock(db,sku);assert.equal(saved.quantity,quantity);
      assert.equal(saved.initial_quantity,1000);assert.equal(saved.package_unit,"bottle");
    }
    assert.equal(stock(db,"coffee-beans").initial_quantity,5000);
    assert.equal(stock(db,"condensed-milk").initial_quantity,1000);
    assert.equal(stock(db,"fresh-eggs").package_unit,"tray");
    assert.equal(stock(db,"straws").quantity,straws);
    db.prepare("UPDATE inventory_items SET quantity=19000 WHERE sku='oat-milk'").run();
    const movements=db.prepare("SELECT COUNT(*) AS n FROM inventory_transactions").get().n;
    assert.equal(applyInventoryCatalog(db),false);
    assert.equal(stock(db,"oat-milk").quantity,19000);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_transactions").get().n,movements);
    assert.equal(lowStockLevel(stock(db,"sprite")),1000);
    assert.equal(lowStockLevel(stock(db,"condensed-milk")),1000);
  }finally{db.close();}
});

test("new and saved recipes use oat milk, deduct 1 L from 20 bottles, and cancel exactly once",()=>{
  const db=fixture();
  try {
    db.prepare(`INSERT INTO inventory_items(sku,product_name,category,quantity,measurement,initial_quantity,low_stock_level)
      VALUES('fresh-milk','Fresh Milk','Old stock',750,'ml',1000,250)`).run();
    const id="caramel-frappe|16oz";
    const old=JSON.parse(db.prepare("SELECT terms_json FROM menu_recipes WHERE id=?").get(id).terms_json);
    db.prepare("UPDATE menu_recipes SET terms_json=? WHERE id=?")
      .run(JSON.stringify(old.map(term=>term.sku==="oat-milk"?{...term,sku:"fresh-milk"}:term)),id);
    applyInventoryCatalog(db);
    assert.equal(stock(db,"fresh-milk").is_archived,1);
    const allTerms=db.prepare("SELECT terms_json FROM menu_recipes").all().flatMap(row=>JSON.parse(row.terms_json));
    assert.equal(allTerms.some(term=>term.sku==="fresh-milk"),false);
    const workflow=createOrderWorkflow(db);
    const payload=body({items:[{productId:"caramel-frappe",quantity:10,options:{Size:"16oz"}}],expectedTotal:1600});
    const order=workflow.create(payload,customer);
    assert.equal(stock(db,"oat-milk").quantity,19000);
    assert.equal(stock(db,"oat-milk").quantity/stock(db,"oat-milk").initial_quantity,19);
    assert.equal(stock(db,"fresh-milk").quantity,750);
    workflow.cancel(order.orderId,customer);workflow.cancel(order.orderId,customer);
    assert.equal(stock(db,"oat-milk").quantity,20000);
  }finally{db.close();}
});

test("unit changes preserve historical allocations, conversions and audit amounts",()=>{
  const db=fixture();
  try {
    const previous=stock(db,"sea-salt-cream");
    assert.equal(previous.measurement,"ml");
    db.prepare(`INSERT INTO inventory_unit_conversions(inventory_item_id,recipe_unit,recipe_amount,stock_unit,stock_amount,is_estimate)
      VALUES(?,'g',120,'ml',100,0)`).run(previous.id);
    const order=db.prepare("INSERT INTO orders(order_number,user_id) VALUES('LEGACY-UNIT-TEST',1)").run().lastInsertRowid;
    db.prepare("INSERT INTO order_stock_allocations(order_id,inventory_item_id,amount) VALUES(?,?,20)").run(order,previous.id);
    db.prepare("INSERT INTO inventory_transactions(order_id,inventory_item_id,change_amount,reason) VALUES(?,?,-20,'Original deduction')").run(order,previous.id);
    applyInventoryCatalog(db);
    const current=stock(db,"sea-salt-cream");
    assert.notEqual(current.id,previous.id);assert.equal(current.measurement,"g");
    const conversion=db.prepare("SELECT * FROM inventory_unit_conversions WHERE inventory_item_id=? AND recipe_unit='ml'").get(current.id);
    assert.equal(conversion.recipe_amount,100);assert.equal(conversion.stock_amount,120);assert.equal(conversion.is_estimate,0);
    const inventory=createInventoryService(db);inventory.restore(order);inventory.restore(order);
    const historic=db.prepare("SELECT * FROM inventory_items WHERE id=?").get(previous.id);
    assert.equal(historic.quantity,previous.quantity+20);assert.equal(historic.is_archived,1);
    assert.equal(stock(db,"sea-salt-cream").quantity,1000);
    assert.equal(db.prepare("SELECT change_amount FROM inventory_transactions WHERE reason='Original deduction'").get().change_amount,-20);
    db.prepare("UPDATE inventory_items SET quantity=0 WHERE is_archived=1").run();
    const expected=db.prepare("SELECT COUNT(*) AS n FROM inventory_items WHERE is_archived=0 AND quantity<=0").get().n;
    assert.equal(createReports(db).summary().outOfStockItems,expected);
  }finally{db.close();}
});

test("owner's Sea Salt Cream estimate resolves recipes and measured replacements are preserved",()=>{
  const db=fixture();
  try {
    applyInventoryCatalog(db);
    const item=stock(db,"sea-salt-cream");
    const row=db.prepare("SELECT * FROM inventory_unit_conversions WHERE inventory_item_id=? AND recipe_unit='ml'").get(item.id);
    assert.equal(row.recipe_amount,25);
    assert.equal(row.stock_amount,19.5);
    assert.equal(row.is_estimate,1);
    assert.equal(createInventoryService(db).recipes().filter(recipe=>recipe.issues.length).length,0);
    const before=item.quantity;
    const workflow=createOrderWorkflow(db);
    const payload=body({items:[
      {productId:"sea-salt-latte",quantity:1,options:{Size:"ICED - 16oz"}},
      {productId:"sea-salt-matcha",quantity:1,options:{Size:"ICED - 16oz"}}
    ]});
    payload.expectedTotal=workflow.prepareQuote(payload).total;
    const order=workflow.create(payload,customer);
    assert.equal(stock(db,"sea-salt-cream").quantity,before-39);
    workflow.cancel(order.orderId,customer);
    assert.equal(stock(db,"sea-salt-cream").quantity,before);
    db.prepare("UPDATE inventory_unit_conversions SET stock_amount=20,is_estimate=0 WHERE inventory_item_id=? AND recipe_unit='ml'").run(item.id);
    require('../services/inventorySetup').seedInventorySetup(db);
    const measured=db.prepare("SELECT * FROM inventory_unit_conversions WHERE inventory_item_id=? AND recipe_unit='ml'").get(item.id);
    assert.equal(measured.stock_amount,20);assert.equal(measured.is_estimate,0);
    assert.equal(stock(db,"sea-salt-cream").quantity,before);
  }finally{db.close();}
});

test("missing mass/volume conversions stay explicit when no saved equivalent exists",()=>{
  const db=fixture();
  try {
    applyInventoryCatalog(db);
    db.prepare("DELETE FROM inventory_unit_conversions WHERE inventory_item_id=?").run(stock(db,"sea-salt-cream").id);
    const issues=createInventoryService(db).recipes().filter(recipe=>recipe.issues.length);
    assert.ok(issues.some(recipe=>recipe.id.startsWith("sea-salt-latte|")));
    assert.ok(issues.every(recipe=>recipe.issues.every(issue=>issue.includes("Sea Salt Cream"))));
  }finally{db.close();}
});

test("the CSV import rolls back completely on a stock-write failure",()=>{
  const db=fixture();
  try {
    const before=db.prepare("SELECT * FROM inventory_items ORDER BY id").all();
    db.exec("CREATE TRIGGER reject_csv BEFORE INSERT ON inventory_transactions BEGIN SELECT RAISE(ABORT,'test failure'); END");
    assert.throws(()=>applyInventoryCatalog(db),/test failure/);
    assert.deepEqual(db.prepare("SELECT * FROM inventory_items ORDER BY id").all(),before);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_catalog_imports").get().n,0);
  }finally{db.close();}
});

test("Inventory displays bottles, remaining measurements and partial packages consistently",()=>{
  const source=fs.readFileSync(path.join(__dirname,"../../Admin/Inventory.js"),"utf8");
  const helpers=vm.runInNewContext(source.slice(source.indexOf("function displayMeasurement"),source.indexOf("function filteredInventory"))+";({displayMeasurement,packageStock})");
  const milk={quantity:20000,initialQuantity:1000,measurement:"ml",packageUnit:"bottle"};
  assert.equal(helpers.packageStock(milk),"20 bottles");
  assert.equal(helpers.displayMeasurement(milk),"20 L");
  assert.equal(helpers.packageStock({...milk,quantity:19000}),"19 bottles");
  assert.equal(helpers.packageStock({...milk,quantity:500}),"0.5 bottles");
  assert.equal(helpers.displayMeasurement({...milk,quantity:500}),"500 ml");
  assert.equal(helpers.packageStock({...milk,quantity:1000}),"1 bottle");
});
