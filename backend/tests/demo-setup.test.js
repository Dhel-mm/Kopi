const { test } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { fixture, body, customer } = require("./fixtures");
const { applyInventoryCatalog } = require("../services/inventoryCatalog");
const { applyDemoSetup } = require("../services/demoSetup");
const { createOrderWorkflow } = require("../services/orderWorkflow");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");

const env = {
  DEMO_SETUP_ENABLED: "true",
  DEMO_CUSTOMER_EMAIL: "demo@example.test",
  DEMO_CUSTOMER_PASSWORD: "Test-only-password-2026"
};
function setup() {
  const db = fixture();
  applyInventoryCatalog(db);
  return db;
}

test("demo setup is disabled by default and does not create an account", () => {
  const db = setup();
  try {
    const before = db.prepare("SELECT * FROM inventory_items").all();
    assert.deepEqual(applyDemoSetup(db, {}), { applied: false });
    assert.deepEqual(db.prepare("SELECT * FROM inventory_items").all(), before);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 3);
  } finally { db.close(); }
});

test("demo stocks every active ingredient, logs top-ups and creates a hashed Customer", () => {
  const db = setup();
  try {
    db.prepare("UPDATE inventory_items SET quantity=0").run();
    const result = applyDemoSetup(db, env);
    assert.equal(result.applied, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_items WHERE is_archived=0 AND quantity<=low_stock_level").get().n, 0);
    const row = db.prepare("SELECT * FROM users WHERE id=?").get(result.customerId);
    assert.equal(row.role, "Customer");
    assert.equal(row.status, "Active");
    assert.equal(bcrypt.compareSync(env.DEMO_CUSTOMER_PASSWORD, row.password_hash), true);
    assert.notEqual(row.password_hash, env.DEMO_CUSTOMER_PASSWORD);
    const straws = db.prepare("SELECT quantity,initial_quantity FROM inventory_items WHERE sku='straws'").get();
    assert.equal(straws.quantity, straws.initial_quantity * 10);
    assert.equal(db.prepare("SELECT quantity FROM inventory_items WHERE sku='oat-milk'").get().quantity, 20000);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_transactions WHERE reason='School demo opening-stock top-up'").get().n, result.restocked);
  } finally { db.close(); }
});

test("demo reruns never replenish consumed stock or overwrite profiles/passwords", () => {
  const db = setup();
  try {
    applyDemoSetup(db, env);
    db.prepare("UPDATE inventory_items SET quantity=0 WHERE sku='oat-milk'").run();
    db.prepare("UPDATE users SET first_name='Changed' WHERE email=?").run(env.DEMO_CUSTOMER_EMAIL);
    assert.deepEqual(applyDemoSetup(db, { DEMO_SETUP_ENABLED: "true" }), { applied: false });
    assert.equal(db.prepare("SELECT quantity FROM inventory_items WHERE sku='oat-milk'").get().quantity, 0);
    assert.equal(db.prepare("SELECT first_name FROM users WHERE email=?").get(env.DEMO_CUSTOMER_EMAIL).first_name, "Changed");
  } finally { db.close(); }
});

test("demo preserves higher stock, archived ingredients and existing orders", () => {
  const db = setup();
  try {
    db.prepare("UPDATE inventory_items SET quantity=999999 WHERE sku='oat-milk'").run();
    db.prepare("UPDATE inventory_items SET is_archived=1,quantity=0 WHERE sku='sugar'").run();
    const order = db.prepare("INSERT INTO orders(order_number,user_id,total) VALUES('KEEP-1',1,123)").run();
    applyDemoSetup(db, env);
    assert.equal(db.prepare("SELECT quantity FROM inventory_items WHERE sku='oat-milk'").get().quantity, 999999);
    assert.equal(db.prepare("SELECT quantity FROM inventory_items WHERE sku='sugar'").get().quantity, 0);
    assert.equal(db.prepare("SELECT total FROM orders WHERE id=?").get(order.lastInsertRowid).total, 123);
  } finally { db.close(); }
});

test("invalid credentials and existing emails cannot alter stock or elevate accounts", () => {
  const db = setup();
  try {
    const before = db.prepare("SELECT * FROM inventory_items").all();
    assert.throws(() => applyDemoSetup(db, { ...env, DEMO_CUSTOMER_PASSWORD: "short" }));
    assert.throws(() => applyDemoSetup(db, { ...env, DEMO_CUSTOMER_EMAIL: "admin@test.invalid" }), /already in use/);
    assert.deepEqual(db.prepare("SELECT * FROM inventory_items").all(), before);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM demo_setup_runs").get().n, 0);
  } finally { db.close(); }
});

test("stock-write errors roll back the entire demo setup", () => {
  const db = setup();
  try {
    db.prepare("UPDATE inventory_items SET quantity=0").run();
    db.exec("CREATE TRIGGER block_demo_stock BEFORE UPDATE ON inventory_items WHEN NEW.sku='oat-milk' BEGIN SELECT RAISE(ABORT,'Test failure'); END");
    assert.throws(() => applyDemoSetup(db, env), /Test failure/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_items WHERE quantity!=0").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM demo_setup_runs").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 3);
  } finally { db.close(); }
});

test("ordering and cancellation still deduct and restore stock after demo setup", () => {
  const db = setup();
  try {
    applyDemoSetup(db, env);
    const workflow = createOrderWorkflow(db);
    const before = db.prepare("SELECT quantity FROM inventory_items WHERE sku='oat-milk'").get().quantity;
    const order = workflow.create(body(), customer);
    assert.ok(db.prepare("SELECT quantity FROM inventory_items WHERE sku='oat-milk'").get().quantity < before);
    workflow.cancel(order.orderId, customer);
    assert.equal(db.prepare("SELECT quantity FROM inventory_items WHERE sku='oat-milk'").get().quantity, before);
  } finally { db.close(); }
});

test("fresh database startup seeds all stock and the customer, and restart preserves consumption", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kopi-demo-test-"));
  const databasePath = path.join(tempDir, "demo.db");
  const start = () => spawnSync(process.execPath, ["-e", "require('./database').close()"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, ...env, DATABASE_PATH: databasePath,
      ADMIN_EMAIL: "fresh.admin@example.test", ADMIN_PASSWORD: "Test-only-admin-2026" },
    encoding: "utf8"
  });
  let db;
  try {
    const first = start();
    assert.equal(first.status, 0, first.stderr);
    db = new Database(databasePath);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_items WHERE is_archived=0 AND quantity<=low_stock_level").get().n, 0);
    assert.equal(db.prepare("SELECT quantity FROM inventory_items WHERE sku='straws'").get().quantity, 1000);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders").get().n, 0);
    const account = db.prepare("SELECT * FROM users WHERE email=?").get(env.DEMO_CUSTOMER_EMAIL);
    assert.equal(account.role, "Customer");
    assert.equal(bcrypt.compareSync(env.DEMO_CUSTOMER_PASSWORD, account.password_hash), true);
    assert.equal(require("../services/inventory").createInventoryService(db).recipes().filter(recipe => recipe.issues.length).length, 0);
    db.prepare("UPDATE inventory_items SET quantity=0 WHERE sku='straws'").run();
    db.close();
    db = null;
    const second = start();
    assert.equal(second.status, 0, second.stderr);
    db = new Database(databasePath);
    assert.equal(db.prepare("SELECT quantity FROM inventory_items WHERE sku='straws'").get().quantity, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 2);
  } finally {
    if (db) db.close();
    // Remove only this test's freshly created temporary directory.
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
