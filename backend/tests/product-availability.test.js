const {test} = require("node:test");
const assert = require("node:assert/strict");
const {fixture, body, customer} = require("./fixtures");
const {createProductAvailability} = require("../services/productAvailability");
const {createOrderWorkflow} = require("../services/orderWorkflow");

test("ingredient shortages disable affected products and restocking restores them without changing stock", () => {
  const db=fixture(), availability=createProductAvailability(db);
  const get=id=>availability.list("Dine-in").find(product=>product.productId===id).available;
  try {
    assert.equal(get("caramel-frappe"),true);
    db.prepare("UPDATE inventory_items SET quantity=0 WHERE sku='caramel-syrup'").run();
    assert.equal(get("caramel-frappe"),false);
    assert.equal(get("cafe-latte"),true);
    db.prepare("UPDATE inventory_items SET quantity=100000 WHERE sku='caramel-syrup'").run();
    assert.equal(get("caramel-frappe"),true);
    assert.equal(db.prepare("SELECT quantity FROM inventory_items WHERE sku='caramel-syrup'").get().quantity,100000);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_transactions").get().n,0);
    assert.throws(()=>availability.list("Delivery"),/Choose Dine-in or Takeout/);
  } finally {db.close();}
});

test("available variants stay usable while the selected unavailable variant or add-on is rejected", () => {
  const db=fixture(), availability=createProductAvailability(db), workflow=createOrderWorkflow(db);
  try {
    db.prepare("UPDATE inventory_items SET quantity=0 WHERE sku='tube-ice'").run();
    assert.equal(availability.list("Dine-in").find(p=>p.productId==="cafe-latte").available,true);
    assert.equal(availability.list("Dine-in").find(p=>p.productId==="caramel-frappe").available,false);
    assert.throws(()=>workflow.prepareQuote(body({items:[{productId:"cafe-latte",quantity:1,options:{Size:"ICED - 16oz"}}],serviceType:"Dine-in"}),true),/Not enough/);
    assert.ok(workflow.prepareQuote(body({items:[{productId:"cafe-latte",quantity:1,options:{Size:"HOT - 12oz"}}],serviceType:"Dine-in"}),true));
    db.prepare("UPDATE inventory_items SET quantity=100000 WHERE sku='tube-ice'").run();
    db.prepare("UPDATE inventory_items SET quantity=0 WHERE sku='coffee-beans'").run();
    assert.equal(availability.list("Dine-in").find(p=>p.productId==="milky-chocolate").available,true);
  } finally {db.close();}
});

test("the last serving becomes unavailable and cancellation restores availability", () => {
  const db=fixture(), availability=createProductAvailability(db), workflow=createOrderWorkflow(db);
  try {
    const {priceItems}=require("../services/pricing");
    const stock=require("../services/inventory").createInventoryService(db);
    const required=stock.requirements(priceItems(body().items),true).find(item=>item.sku==="caramel-syrup");
    db.prepare("UPDATE inventory_items SET quantity=? WHERE id=?").run(required.amount,required.id);
    const created=workflow.create(body(),customer);
    assert.equal(availability.list("Dine-in").find(p=>p.productId==="caramel-frappe").available,false);
    workflow.cancel(created.orderId,customer);
    assert.equal(availability.list("Dine-in").find(p=>p.productId==="caramel-frappe").available,true);
    db.prepare("UPDATE inventory_items SET quantity=0 WHERE sku='paper-bag'").run();
    assert.equal(availability.list("Dine-in").find(p=>p.productId==="caramel-frappe").available,true);
    assert.equal(availability.list("Takeout").find(p=>p.productId==="caramel-frappe").available,false);
  } finally {db.close();}
});
