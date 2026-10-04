const bcrypt = require("bcryptjs");
const accounts = require("./accounts");
const { items } = require("../catalog/inventory-2026-09.json");

const VERSION = "school-demo-2026-10-05-v1";

// Explicitly opt in for school demonstrations only. Credentials belong in the
// environment, never the repository. This does not reset existing accounts.
function applyDemoSetup(db, env = process.env) {
  if (env.DEMO_SETUP_ENABLED !== "true") return { applied: false };

  db.exec(`CREATE TABLE IF NOT EXISTS demo_setup_runs (
    version TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  if (db.prepare("SELECT 1 FROM demo_setup_runs WHERE version=?").get(VERSION)) {
    return { applied: false };
  }

  const email = accounts.email(env.DEMO_CUSTOMER_EMAIL);
  const password = accounts.password(env.DEMO_CUSTOMER_PASSWORD);
  if (db.prepare("SELECT 1 FROM users WHERE lower(email)=?").get(email)) {
    throw new Error("Demo customer email is already in use. Choose a new email; existing accounts were not changed.");
  }
  const hash = bcrypt.hashSync(password, 12);
  const openingQuantities = new Map(items.map(item => [item.sku, item.quantity]));

  return db.transaction(() => {
    if (db.prepare("SELECT 1 FROM demo_setup_runs WHERE version=?").get(VERSION)) {
      return { applied: false };
    }
    const stock = db.prepare("SELECT * FROM inventory_items WHERE is_archived=0").all();
    const update = db.prepare("UPDATE inventory_items SET quantity=?,updated_at=CURRENT_TIMESTAMP WHERE id=?");
    const movement = db.prepare(`INSERT INTO inventory_transactions
      (inventory_item_id,change_amount,reason) VALUES(?,?,'School demo opening-stock top-up')`);
    let restocked = 0;
    for (const item of stock) {
      // CSV quantities take precedence; missing supplies receive ten packages.
      // Also exceed the item's low-stock threshold without reducing existing stock.
      const target = Math.max(
        openingQuantities.get(item.sku) ?? item.initial_quantity * 10,
        item.initial_quantity * 2,
        item.low_stock_level * 2,
        1
      );
      if (!Number.isFinite(target) || !Number.isFinite(item.quantity)) {
        throw new Error("Invalid inventory quantity. Demo setup canceled.");
      }
      if (item.quantity < target) {
        update.run(target, item.id);
        movement.run(item.id, target - item.quantity);
        restocked++;
      }
    }
    const customer = db.prepare(`INSERT INTO users
      (first_name,last_name,email,password_hash,role,status)
      VALUES('Demo','Customer',?,?,'Customer','Active')`).run(email, hash);
    db.prepare("INSERT INTO demo_setup_runs(version) VALUES(?)").run(VERSION);
    return { applied: true, restocked, customerId: Number(customer.lastInsertRowid) };
  }).immediate();
}

module.exports = { applyDemoSetup, VERSION };
