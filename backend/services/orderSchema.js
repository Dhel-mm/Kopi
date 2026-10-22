const recipes = require("./recipeDefaults");
function migrateOrderWorkflow(db) {
  db.transaction(() => {
    const columns = new Set(db.prepare("PRAGMA table_info(orders)").all().map(row => row.name));
    const isNew = !columns.has("inventory_state");
    for (const [name, sql] of Object.entries({
      inventory_state: "TEXT NOT NULL DEFAULT 'legacy'",
      request_key: "TEXT", request_hash: "TEXT",
      refund_status: "TEXT NOT NULL DEFAULT 'Not required'",
      rider_fee_cents: "INTEGER CHECK(rider_fee_cents >= 0)",
      delivery_tracking_url: "TEXT",
      delivery_message: "TEXT",
      delivery_revision: "INTEGER NOT NULL DEFAULT 0",
      delivery_sent_at: "TEXT",
      delivery_sent_by: "INTEGER REFERENCES users(id)",
      delivery_acknowledged_at: "TEXT",
      cancellation_reason: "TEXT",
      payment_rejected_at: "TEXT",
      payment_rejected_by: "INTEGER REFERENCES users(id)",
      cancellation_acknowledged_at: "TEXT",
      cash_tendered: "REAL CHECK(cash_tendered >= 0)",
      cash_change: "REAL CHECK(cash_change >= 0)",
      // Senior Citizen / PWD discount record (kept for BIR-style reporting).
      special_discount_type: "TEXT CHECK(special_discount_type IN ('Senior Citizen','PWD'))",
      special_discount_id: "TEXT",
      special_discount_name: "TEXT",
      special_discount_items_json: "TEXT",
      special_discount: "REAL NOT NULL DEFAULT 0 CHECK(special_discount >= 0)",
      vat_exempt: "REAL NOT NULL DEFAULT 0 CHECK(vat_exempt >= 0)"
    })) if (!columns.has(name)) db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${sql}`);
    // Correct older cash receipts only where collection is evidenced by tender or completion.
    db.exec(`UPDATE orders SET payment_status='Paid' WHERE payment='Cash' AND payment_status='Unpaid'
      AND (status='Completed' OR (order_type='In-store' AND cash_tendered IS NOT NULL AND cash_tendered>=total))`);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS orders_request_key ON orders(user_id, request_key) WHERE request_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS orders_pending_delivery ON orders(user_id,delivery_sent_at,id)
        WHERE delivery_revision>0 AND delivery_acknowledged_at IS NULL AND status!='Canceled';
      CREATE TABLE IF NOT EXISTS order_stock_allocations (
        order_id INTEGER NOT NULL REFERENCES orders(id),
        inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
        amount REAL NOT NULL CHECK(amount > 0),
        returned_amount REAL NOT NULL DEFAULT 0 CHECK(returned_amount >= 0),
        PRIMARY KEY(order_id, inventory_item_id)
      );
      CREATE TABLE IF NOT EXISTS menu_recipes (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, terms_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS inventory_unit_conversions (
        inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
        recipe_unit TEXT NOT NULL CHECK(recipe_unit IN ('g','ml','pcs')),
        recipe_amount REAL NOT NULL CHECK(recipe_amount > 0),
        stock_unit TEXT NOT NULL CHECK(stock_unit IN ('g','ml','pcs')),
        stock_amount REAL NOT NULL CHECK(stock_amount > 0),
        is_estimate INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER REFERENCES users(id),
        PRIMARY KEY(inventory_item_id, recipe_unit),
        CHECK(recipe_unit != stock_unit)
      );
    `);
    const conversionColumns = new Set(db.prepare("PRAGMA table_info(inventory_unit_conversions)").all().map(row=>row.name));
    if (!conversionColumns.has("is_estimate")) db.exec("ALTER TABLE inventory_unit_conversions ADD COLUMN is_estimate INTEGER NOT NULL DEFAULT 0");
    const seed = db.prepare("INSERT INTO menu_recipes(id,label,terms_json) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING");
    recipes.forEach(recipe => seed.run(recipe.id,recipe.label,JSON.stringify(recipe.terms)));
    if (isNew) {
      // Migrate only actual recorded deductions for open legacy orders. Never invent historic usage.
      db.exec(`
        INSERT INTO order_stock_allocations(order_id,inventory_item_id,amount)
        SELECT m.order_id,m.inventory_item_id,-SUM(m.change_amount)
        FROM inventory_transactions m JOIN orders o ON o.id=m.order_id
        WHERE o.status IN ('New','Preparing') AND m.change_amount < 0
          AND m.reason IN ('Customer order','In-store order')
        GROUP BY m.order_id,m.inventory_item_id;
        UPDATE orders SET inventory_state = CASE status WHEN 'New' THEN 'reserved' ELSE 'consumed' END
        WHERE status IN ('New','Preparing');
      `);
    }
    require("./inventory").migrateReorderSettings(db);
    require("./orderSafety").migrateOrderSafety(db);
    require("./idRegistry").migrateIdRegistry(db);
    require("./inventorySetup").seedInventorySetup(db);
    require("./inventoryCatalog").migrateInventoryPackages(db);
  })();
}
module.exports = { migrateOrderWorkflow };
