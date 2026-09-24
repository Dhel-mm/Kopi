const {test}=require("node:test");
const assert=require("node:assert/strict");
const {fixture,customer,admin,body}=require("./fixtures");
const {quote,catalog}=require("../services/pricing");
const {createInventoryService,lowStockLevel}=require("../services/inventory");
const {createOrderWorkflow}=require("../services/orderWorkflow");
const stock=(db,sku)=>db.prepare("SELECT quantity FROM inventory_items WHERE sku=?").get(sku).quantity;

test("server prices override browser prices, names, fees and fake voucher discounts",()=>{
  const q=quote(body({deliveryFee:999,voucherDiscount:999}));
  assert.equal(q.total,160);assert.equal(q.items[0].name,"Caramel Frappe");
  assert.equal(q.items[0].price,160);assert.equal(q.deliveryFee,0);
  assert.equal(quote(body({voucher:"kopi10",voucherDiscount:999})).total,150);
  assert.throws(()=>quote(body({voucher:"FREE"})),/not valid/);
  assert.throws(()=>quote(body({discount:999}),true),/exceed/);
});
test("reject missing size, invalid products/options, fractional and non-finite quantities",()=>{
  for(const quantity of [0,-1,1.5,Infinity,NaN,"1",101]) assert.throws(()=>quote(body({items:[{productId:"caramel-frappe",quantity}]})));
  assert.throws(()=>quote(body({items:[{productId:"unknown",quantity:1}]})));
  assert.throws(()=>quote(body({items:[{productId:"cafe-latte",quantity:1,options:{}}]})),/choose/);
  assert.throws(()=>quote(body({items:[{productId:"kopi-special",quantity:1,options:{Size:"HOT - 12oz"}}]})));
  assert.throws(()=>quote(body({items:[{productId:"caramel-frappe",quantity:1,options:{"Free topping":"Yes"}}]})));
});
test("all 45 menu products and each offered variant resolve to configured recipe definitions",()=>{
  const db=fixture(),inventory=createInventoryService(db);
  try {
    assert.equal(catalog.products.length,45);
    for(const product of catalog.products) for(const variant of Object.keys(product.prices)) {
      const key=product.options.find(o=>o.priceKey);
      const options=key?{[key.label]:variant}:{};
      const q=quote(body({items:[{productId:product.id,quantity:1,options}]}));
      assert.ok(inventory.check(q.items,true).length>0,product.id+" "+variant);
    }
  } finally {db.close();}
});
test("hot/iced, less ice, optional add-ons, doubled chicken flavor and takeout packaging",()=>{
  const db=fixture(),inventory=createInventoryService(db);
  try {
    function needed(productId,options={},quantity=1,takeout=true) {
      const items=quote(body({items:[{productId,quantity,options}]})).items;
      return Object.fromEntries(inventory.requirements(items,takeout).map(row=>[row.sku,row.amount]));
    }
    const hot=needed("cafe-latte",{Size:"HOT - 12oz","Ice Level":"Less Ice"});
    assert.equal(hot["tube-ice"],undefined);assert.equal(hot["12oz-cups"],1);
    const iced=needed("cafe-latte",{Size:"ICED - 16oz","Ice Level":"Less Ice","Add-ons (worth ₱30)":"Espresso shot"},2);
    assert.equal(iced["coffee-beans"],60);assert.equal(iced["tube-ice"],144);
    assert.equal(iced["paper-bag"],1);assert.equal(iced["straws"],2);
    const oat=needed("matcha-latte",{Size:"ICED - 16oz","Add-ons (worth ₱30)":"Oat milk"});
    assert.equal(oat["oat-milk"],60);
    assert.equal(needed("lychee",{"Add-ons (worth ₱30)":"Syrup-Sauce"})["lychee-syrup"],35);
    assert.equal(needed("chicken-wings",{Pieces:"12pcs",Flavors:"Sweet Chili"})["sweet-chili"],60);
    assert.equal(needed("liempo",{},1,false)["takeout-container"],undefined);
    assert.equal(needed("liempo")["plastic-spoon"],1);
    assert.equal(needed("liempo")["plastic-fork"],1);
  } finally {db.close();}
});
test("creation reserves exact stock; retries return the same order without double deduction",()=>{
  const db=fixture(),workflow=createOrderWorkflow(db);
  try {
    const request=body(),before=stock(db,"caramel-syrup");
    const first=workflow.create(request,customer);
    assert.equal(first.total,160);
    assert.equal(stock(db,"caramel-syrup"),before-20);
    assert.equal(workflow.create(request,customer).orderId,first.orderId);
    assert.equal(stock(db,"caramel-syrup"),before-20);
    assert.throws(()=>workflow.create({...request,phone:"09999999999"},customer),/different order/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders").get().n,1);
  } finally {db.close();}
});
test("short stock or unresolved units roll back the entire order and every stock movement",()=>{
  const db=fixture(),workflow=createOrderWorkflow(db);
  try {
    db.prepare("UPDATE inventory_items SET quantity=0 WHERE sku='straws'").run();
    const before=stock(db,"coffee-beans");
    assert.throws(()=>workflow.create(body(),customer),/Not enough/);
    assert.equal(stock(db,"coffee-beans"),before);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders").get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_transactions").get().n,0);
    db.prepare("UPDATE inventory_items SET measurement='pcs' WHERE sku='caramel-syrup'").run();
    assert.throws(()=>workflow.create(body(),customer),/stock uses/);
  } finally {db.close();}
});
test("new-order cancellation restores only its allocations exactly once, even after recipe changes",()=>{
  const db=fixture(),workflow=createOrderWorkflow(db);
  try {
    const before=stock(db,"caramel-syrup"),order=workflow.create(body(),customer);
    db.prepare("UPDATE menu_recipes SET terms_json=? WHERE id='caramel-frappe|16oz'").run(JSON.stringify([{sku:"caramel-syrup",amount:999,unit:"ml"}]));
    assert.throws(()=>workflow.cancel(order.orderId,{id:3,role:"Customer"}),/not found/);
    assert.equal(workflow.cancel(order.orderId,customer).inventoryState,"returned");
    assert.equal(stock(db,"caramel-syrup"),before);
    workflow.cancel(order.orderId,customer);
    assert.equal(stock(db,"caramel-syrup"),before);
    const total=db.prepare("SELECT SUM(change_amount) AS n FROM inventory_transactions WHERE order_id=?").get(order.orderId).n;
    assert.equal(total,0);
    assert.throws(()=>workflow.advance(order.orderId,"Preparing",admin),/Invalid/);
  } finally {db.close();}
});
test("preparing cancellations keep consumed stock; completed orders cannot be canceled",()=>{
  const db=fixture(),workflow=createOrderWorkflow(db);
  try {
    const order=workflow.create(body(),customer),after=stock(db,"coffee-beans");
    workflow.advance(order.orderId,"Preparing",admin);
    assert.equal(workflow.cancel(order.orderId,customer).inventoryState,"consumed");
    assert.equal(stock(db,"coffee-beans"),after);
    const pos=workflow.create(body({serviceType:"Dine-in"}),admin,true);
    assert.equal(pos.status,"Preparing");
    workflow.advance(pos.orderId,"Completed",admin);
    assert.throws(()=>workflow.cancel(pos.orderId,admin),/Only new/);
  } finally {db.close();}
});
test("stock cannot oversell; the final available serving is reserved only once",()=>{
  const db=fixture(),workflow=createOrderWorkflow(db);
  try {
    db.prepare("UPDATE inventory_items SET quantity=18 WHERE sku='coffee-beans'").run();
    workflow.create(body(),customer);
    assert.throws(()=>workflow.create(body(),customer),/Not enough/);
    assert.equal(stock(db,"coffee-beans"),0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders").get().n,1);
  } finally {db.close();}
});
test("GCash remains unverified, cannot advance, and cancellation flags manual refund review",()=>{
  const db=fixture(),workflow=createOrderWorkflow(db);
  try {
    const order=workflow.create(body({payment:"GCash",paymentReference:"0001234567890",paymentStatus:"Verified"}),customer);
    assert.equal(order.paymentStatus,"Pending verification");
    assert.throws(()=>workflow.advance(order.orderId,"Preparing",admin),/Verify/);
    assert.equal(workflow.cancel(order.orderId,customer).refundStatus,"Needs staff review");
    assert.throws(()=>workflow.create(body({payment:"GCash",paymentReference:"0001234567890"}),customer),/UNIQUE/);
  } finally {db.close();}
});
test("stock thresholds use 25% per package and a whole package for the three special products",()=>{
  assert.equal(lowStockLevel({sku:"fresh-milk",initial_quantity:1000}),250);
  assert.equal(lowStockLevel({sku:"sugar",initial_quantity:250}),250);
  assert.equal(lowStockLevel({sku:"condensed-milk",initial_quantity:390}),390);
  assert.equal(lowStockLevel({sku:"sprite",initial_quantity:1500}),1500);
});
test("server requires a quote total, phone format, supported service type and unique checkout key",()=>{
  const db=fixture(),workflow=createOrderWorkflow(db);
  try {
    for(const change of [{expectedTotal:1},{expectedTotal:null},{phone:"123"},{requestKey:"bad"}]) {
      assert.throws(()=>workflow.create(body(change),customer));
    }
    assert.throws(()=>workflow.create(body({serviceType:"Bad"}),admin,true));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders").get().n,0);
  } finally {db.close();}
});
