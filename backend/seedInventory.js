const fs = require("fs");
const path = require("path");
const db = require("./database");

/*
  The existing Admin inventory catalog is the single source for every stock
  item.  This script imports it once into SQLite without replacing stock the
  administrator has already counted or adjusted.
*/
const catalogFile = path.join(__dirname, "..", "Admin", "InventoryData.js");
const catalogText = fs.readFileSync(catalogFile, "utf8");
const catalogMatch = catalogText.match(/const catalog = \[([\s\S]*?)\]\.map/);

if (!catalogMatch) {
  throw new Error("Could not find the inventory catalog in Admin/InventoryData.js.");
}

const rawCatalog = Function(`"use strict"; return [${catalogMatch[1]}];`)();
const categoryNames = {
  "Sweeteners & Syrups": "Sweeteners & Concentrate Syrups",
  "Mix-ins & Garnishes": "Crunchy Mix-ins & Garnishes",
  "Disposables & Service": "Disposables & Service Hardware"
};
const stockOverrides = {
  "chicken-wings": { quantity: 1000, measurement: "g" },
  "cooking-oil": { quantity: 1000, measurement: "ml" }
};
const productNames = {
  sprite: "Sprite"
};
const specialLowStockSkus = new Set(["sugar", "condensed-milk", "sprite"]);

const inventoryItems = rawCatalog.map(([sku, suppliedName, category, quantity, measurement]) => {
  const override = stockOverrides[sku] || {};
  const initialQuantity = override.quantity ?? quantity;
  const itemMeasurement = override.measurement ?? measurement;
  const productName = productNames[sku]
    || suppliedName.replace(/\s*\([^)]*\)\s*$/, "").trim();

  return [
    sku,
    productName,
    categoryNames[category] || category,
    initialQuantity,
    itemMeasurement,
    specialLowStockSkus.has(sku) ? initialQuantity : initialQuantity * 0.25
  ];
});

const recipes = {
  "caramel-frappe": {
    "coffee-beans": 18,
    "caramel-syrup": 25,
    "fresh-milk": 120,
    "cream-base": 100,
    "whipped-cream": 15,
    "tube-ice": 180,
    "16oz-cups": 1,
    "straws": 1
  }
};

const addItem = db.prepare(`
  INSERT INTO inventory_items (
    sku, product_name, category, quantity,
    measurement, initial_quantity, low_stock_level
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(sku) DO NOTHING
`);

const addRecipe = db.prepare(`
  INSERT INTO product_recipes (
    menu_product_id, inventory_item_id, amount_required
  ) VALUES (?, ?, ?)
  ON CONFLICT(menu_product_id, inventory_item_id) DO NOTHING
`);

const syncItemDetails = db.prepare(`
  UPDATE inventory_items
  SET product_name = ?, category = ?, measurement = ?,
      initial_quantity = ?, low_stock_level = ?
  WHERE sku = ?
`);

db.transaction(() => {
  inventoryItems.forEach(item => {
    addItem.run(
      item[0], item[1], item[2],
      item[3], item[4], item[3], item[5]
    );
    syncItemDetails.run(item[1], item[2], item[4], item[3], item[5], item[0]);
  });

  Object.entries(recipes["caramel-frappe"]).forEach(([sku, amount]) => {
    const ingredient = db
      .prepare("SELECT id FROM inventory_items WHERE sku = ?")
      .get(sku);

    addRecipe.run("caramel-frappe", ingredient.id, amount);
  });
})();

require("./services/inventorySetup").seedInventorySetup(db);
console.log(`${inventoryItems.length} original stock products imported; recipe inventory setup is ready.`);
