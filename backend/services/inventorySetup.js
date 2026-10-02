// Starter assumptions authorized by the owner. They are not measured shop data.
// Existing quantities, package sizes, edited recipes and measured conversions are preserved.
const extraIngredients = [
  ["oat-milk", "Oat Milk", "Dairy, Creams & Toppings", "ml", 1000],
  ["white-chocolate-sauce", "White Chocolate Sauce", "Sweeteners & Concentrate Syrups", "ml", 1000],
  ["salted-caramel-sauce", "Salted Caramel Sauce", "Sweeteners & Concentrate Syrups", "ml", 750],
  ["chocolate-sauce", "Chocolate Sauce", "Sweeteners & Concentrate Syrups", "ml", 1000],
  ["strawberry-topping", "Strawberry Jam Topping", "Crunchy Mix-ins & Garnishes", "g", 1000],
  ["snack-toppings", "Snack Topping Mix (Grated Cheese)", "Carbs, Sides & Cheese", "g", 500],
  ["nachos-sauce", "Nacho Salsa", "Carbs, Sides & Cheese", "ml", 1000]
];
const starterConversions = [
  // SKU, recipe amount/unit, amount in the existing stock unit.
  ["chicken-wings", 1, "pcs", 50, "g"],
  ["chicken-fingers", 1, "pcs", 35, "g"],
  ["condensed-milk", 20, "ml", 26, "g"],
  ["garlic-parmesan", 20, "g", 20, "ml"],
  ["cheese-sauce", 50, "g", 50, "ml"],
  ["bangus", 350, "g", 1, "pcs"],
  // Owner's 18–21 g range per 25 ml, midpoint; remains explicitly estimated.
  ["sea-salt-cream", 25, "ml", 19.5, "g"]
];

function seedInventorySetup(db) {
  db.transaction(() => {
    const add = db.prepare(`
      INSERT INTO inventory_items(sku,product_name,category,quantity,measurement,initial_quantity,low_stock_level)
      VALUES(?,?,?,0,?,?,?) ON CONFLICT(sku) DO NOTHING
    `);
    for (const [sku,name,category,unit,pack] of extraIngredients) {
      add.run(sku,name,category,unit,pack,pack*0.25);
    }
    const addConversion = db.prepare(`
      INSERT INTO inventory_unit_conversions(inventory_item_id,recipe_unit,recipe_amount,stock_unit,stock_amount,is_estimate)
      VALUES(?,?,?,?,?,1) ON CONFLICT(inventory_item_id,recipe_unit) DO NOTHING
    `);
    for (const [sku,recipeAmount,recipeUnit,stockAmount,stockUnit] of starterConversions) {
      const stock = db.prepare("SELECT id,measurement FROM inventory_items WHERE sku=?").get(sku);
      if (stock?.measurement === stockUnit) addConversion.run(stock.id,recipeUnit,recipeAmount,stockUnit,stockAmount);
    }
  })();
}
module.exports = {seedInventorySetup, extraIngredients, starterConversions};
