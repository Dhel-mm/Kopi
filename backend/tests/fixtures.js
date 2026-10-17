const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { migrateManualPayments } = require("../services/manualPayment");
const { migrateOrderWorkflow } = require("../services/orderSchema");
const defaults = require("../services/recipeDefaults");
function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  // Reuse CREATE TABLE declarations only. Never load database.js or the real .env/database.
  const source = fs.readFileSync(path.join(__dirname,"../database.js"),"utf8");
  for (const match of source.matchAll(/db\.exec\(`([\s\S]*?)`\)/g)) {
    if (match[1].includes("CREATE TABLE")) db.exec(match[1]);
  }
  db.exec("ALTER TABLE orders ADD COLUMN customer_name TEXT; ALTER TABLE orders ADD COLUMN service_type TEXT;");
  db.prepare("INSERT INTO users(id,first_name,last_name,email,password_hash,role) VALUES(1,'Test','Customer','customer@test.invalid','unused','Customer'),(2,'Test','Admin','admin@test.invalid','unused','Admin'),(3,'Another','Customer','other@test.invalid','unused','Customer')").run();
  migrateManualPayments(db);
  migrateOrderWorkflow(db);
  require("../services/accountSchema").migrateAccounts(db);
  const units = new Map();
  for (const recipe of defaults) for (const term of recipe.terms) if (!units.has(term.sku)) units.set(term.sku,term.unit);
  // Unit conversions here are test-only setup, not assumptions about the shop's real supplies.
  for (const [sku,unit] of units) db.prepare("INSERT INTO inventory_items(sku,product_name,category,quantity,measurement,initial_quantity,low_stock_level) VALUES(?,?,'Test',100000,?,1000,250) ON CONFLICT(sku) DO UPDATE SET quantity=100000,measurement=excluded.measurement,initial_quantity=1000,low_stock_level=250").run(sku,sku,unit);
  for (const recipe of defaults) {
    const terms=recipe.terms.map(term=>({...term,unit:units.get(term.sku)}));
    db.prepare("UPDATE menu_recipes SET terms_json=? WHERE id=?").run(JSON.stringify(terms),recipe.id);
  }
  return db;
}
const customer={id:1,role:"Customer"};
const admin={id:2,role:"Admin"};
function body(overrides={}) {
  return {
    items:[{productId:"caramel-frappe",quantity:1,options:{"Size":"16oz"},price:1,name:"Forged name"}],
    address:"Test address",phone:"09123456789",payment:"Cash",
    expectedTotal:160,cashTendered:160,requestKey:require("node:crypto").randomUUID(),
    ...overrides
  };
}
module.exports={fixture,customer,admin,body};
