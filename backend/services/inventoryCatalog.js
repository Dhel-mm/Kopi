const {items} = require("../catalog/inventory-2026-09.json");
const {lowStockLevel, round} = require("./inventory");
const VERSION = "owner-inventory-2026-09-26";

function migrateInventoryPackages(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(inventory_items)").all().map(row => row.name));
  for (const [name, definition] of Object.entries({
    package_unit: "TEXT NOT NULL DEFAULT 'package'",
    is_archived: "INTEGER NOT NULL DEFAULT 0",
    catalog_order: "INTEGER"
  })) if (!columns.has(name)) db.exec(`ALTER TABLE inventory_items ADD COLUMN ${name} ${definition}`);
  db.exec(`CREATE TABLE IF NOT EXISTS inventory_catalog_imports (
    version TEXT PRIMARY KEY, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    product_count INTEGER NOT NULL
  )`);
}

// Supplies absent from the CSV remain separate products. Never invent opening stock.
const supplies = [
  ["sugar", "Sugar", "Sweeteners & Concentrate Syrups", "g", 250, "pouch"],
  ["nachos", "Nachos", "Snacks", "g", 500, "bag"],
  ["cheese-sauce", "Cheese Sauce", "Snacks", "ml", 1000, "container"],
  ["12oz-cups", "12oz Cups", "Disposables & Service Hardware", "pcs", 50, "pack"],
  ["16oz-cups", "16oz Cups", "Disposables & Service Hardware", "pcs", 50, "pack"],
  ["straws", "Straws", "Disposables & Service Hardware", "pcs", 100, "pack"],
  ["paper-bag", "Paper Bag", "Packaging & Utensils", "pcs", 50, "pack"],
  ["takeout-container", "Takeout Container", "Packaging & Utensils", "pcs", 50, "pack"],
  ["plastic-spoon", "Plastic Spoon", "Packaging & Utensils", "pcs", 100, "pack"],
  ["plastic-fork", "Plastic Fork", "Packaging & Utensils", "pcs", 100, "pack"]
];

function applyInventoryCatalog(db) {
  migrateInventoryPackages(db);
  return db.transaction(() => {
    if (db.prepare("SELECT 1 FROM inventory_catalog_imports WHERE version=?").get(VERSION)) return false;
    const insert = db.prepare(`INSERT INTO inventory_items
      (sku,product_name,category,quantity,measurement,initial_quantity,low_stock_level,package_unit,catalog_order)
      VALUES(?,?,?,?,?,?,?,?,?)`);
    const update = db.prepare(`UPDATE inventory_items SET product_name=?,category=?,quantity=?,
      initial_quantity=?,low_stock_level=?,package_unit=?,catalog_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`);
    const movement = db.prepare(`INSERT INTO inventory_transactions(inventory_item_id,change_amount,reason) VALUES(?,?,?)`);
    const find = db.prepare("SELECT * FROM inventory_items WHERE sku=?");
    for (const [index, item] of items.entries()) {
      let previous = find.get(item.sku), oldUnits;
      // Keep historical allocations and movements in their ORIGINAL units and item ID.
      // New stock uses a new row only when the physical unit has changed.
      if (previous && previous.measurement !== item.measurement) {
        oldUnits = previous;
        db.prepare("UPDATE inventory_items SET sku=?,is_archived=1 WHERE id=?")
          .run(item.sku+"-legacy-"+previous.id, previous.id);
        previous = undefined;
      }
      const low = lowStockLevel({sku:item.sku, initial_quantity:item.packageQuantity});
      let id;
      if (previous) {
        id = previous.id;
        update.run(item.productName,item.category,item.quantity,item.packageQuantity,low,item.packageUnit,index,id);
      } else {
        id = insert.run(item.sku,item.productName,item.category,item.quantity,item.measurement,item.packageQuantity,low,item.packageUnit,index).lastInsertRowid;
      }
      const change = round(item.quantity-(previous?.quantity || 0));
      if (change) movement.run(id,change,"Inventory.csv opening-stock replacement (2026-09-26)");
      if (oldUnits) {
        // Reuse a measured/estimated relationship only when the old conversion proves it.
        const reverse = db.prepare(`SELECT * FROM inventory_unit_conversions
          WHERE inventory_item_id=? AND recipe_unit=? AND stock_unit=?`)
          .get(oldUnits.id,item.measurement,oldUnits.measurement);
        if (reverse) db.prepare(`INSERT INTO inventory_unit_conversions
          (inventory_item_id,recipe_unit,recipe_amount,stock_unit,stock_amount,is_estimate,updated_by)
          VALUES(?,?,?,?,?,?,?)`).run(id,oldUnits.measurement,reverse.stock_amount,item.measurement,
            reverse.recipe_amount,reverse.is_estimate,reverse.updated_by);
        // Deliberately do not assume that 1 ml weighs 1 g for Sea Salt Cream.
      }
    }
    for (const [sku,name,category,unit,pack,label] of supplies) {
      const existing = find.get(sku);
      if (!existing) insert.run(sku,name,category,0,unit,pack,lowStockLevel({sku,initial_quantity:pack}),label,null);
      else if (existing.package_unit === "package") db.prepare("UPDATE inventory_items SET package_unit=? WHERE id=?").run(label,existing.id);
    }
    // Future orders use oat milk; never rewrite old allocations or transfer fresh-milk stock.
    for (const recipe of db.prepare("SELECT id,terms_json FROM menu_recipes").all()) {
      const terms = JSON.parse(recipe.terms_json);
      if (!terms.some(term => term.sku === "fresh-milk")) continue;
      db.prepare("UPDATE menu_recipes SET terms_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(JSON.stringify(terms.map(term => term.sku === "fresh-milk" ? {...term,sku:"oat-milk"} : term)),recipe.id);
    }
    db.prepare("UPDATE inventory_items SET is_archived=1 WHERE sku='fresh-milk'").run();
    require("./inventorySetup").seedInventorySetup(db);
    db.prepare("INSERT INTO inventory_catalog_imports(version,product_count) VALUES(?,?)").run(VERSION,items.length);
    return true;
  }).immediate();
}

module.exports = {migrateInventoryPackages,applyInventoryCatalog,items,VERSION};
