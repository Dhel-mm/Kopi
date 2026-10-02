const {test} = require("node:test");
const assert = require("node:assert/strict");
const {fixture,body} = require("./fixtures");
const {quote} = require("../services/pricing");
const {createInventoryService} = require("../services/inventory");
const {sendError} = require("../services/orderWorkflow");

test("customer stock notice names the real product, hides ingredients, and preserves admin diagnostics", () => {
  const db = fixture();
  try {
    const inventory = createInventoryService(db);
    const items = quote(body()).items;
    const milk = inventory.requirements(items, true).find(item => item.sku === "oat-milk");
    assert.ok(milk);
    db.prepare("UPDATE inventory_items SET quantity=? WHERE id=?").run(milk.amount * 1.5, milk.id);
    inventory.check(items, true);
    const doubled = items.map(item => ({...item, quantity: 2}));
    let shortage;
    assert.throws(() => inventory.check(doubled, true), error => {
      shortage = error;
      assert.equal(error.customerMessage, "Not available: Caramel Frappe.");
      return /Not enough/.test(error.message);
    });
    const response = {status(code) {this.code = code; return this;}, json(value) {this.value = value; return this;}};
    sendError(response, shortage, true);
    assert.equal(response.code, 409);
    assert.deepEqual(response.value, {message: "Not available: Caramel Frappe."});
    sendError(response, shortage);
    assert.match(response.value.message, /Need .*available/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_transactions").get().n, 0);
  } finally {db.close();}
});

test("shared shortages list affected products only once, including order packaging", () => {
  const db = fixture();
  try {
    const inventory = createInventoryService(db);
    const items = quote(body()).items;
    db.prepare("UPDATE inventory_items SET quantity=0 WHERE sku='paper-bag'").run();
    assert.throws(() => inventory.check([...items, ...items], true), error => {
      assert.equal(error.customerMessage, "Not available: Caramel Frappe.");
      return true;
    });
  } finally {db.close();}
});
