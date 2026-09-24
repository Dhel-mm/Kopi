const { OrderError } = require("./pricing");
const specialLowStock = new Set(["sugar", "condensed-milk", "sprite"]);
const round = value => Math.round(value * 1000) / 1000;
const lowStockLevel = item => round(item.initial_quantity * (specialLowStock.has(item.sku) ? 1 : 0.25));

function inStockUnits(term, stock, db) {
  if (stock.measurement === term.unit) return term.amount;
  const conversion = db.prepare(`
    SELECT * FROM inventory_unit_conversions
    WHERE inventory_item_id = ? AND recipe_unit = ? AND stock_unit = ?
  `).get(stock.id, term.unit, stock.measurement);
  if (!conversion) {
    throw new OrderError(`${stock.product_name}: recipe uses ${term.unit}, stock uses ${stock.measurement}. Save a measured unit conversion in Inventory first.`, 409);
  }
  return term.amount * conversion.stock_amount / conversion.recipe_amount;
}

function validateTerms(terms, db) {
  if (!Array.isArray(terms) || !terms.length || terms.length > 40) throw new OrderError("A recipe needs 1 to 40 ingredients.");
  return terms.map(term => {
    if (!term || typeof term.sku !== "string" || !["g","ml","pcs"].includes(term.unit) ||
        typeof term.amount !== "number" || !Number.isFinite(term.amount) ||
        term.amount <= 0 || term.amount > 100000 || round(term.amount) !== term.amount) {
      throw new OrderError("Enter an ingredient, unit and positive quantity (up to 3 decimal places) on each row.");
    }
    const item = db.prepare("SELECT * FROM inventory_items WHERE sku=?").get(term.sku);
    if (!item) throw new OrderError("Add the missing inventory product first: "+term.sku);
    try { inStockUnits(term, item, db); }
    catch (error) { throw new OrderError(error.message); }
    return { sku: term.sku, amount: term.amount, unit: term.unit };
  });
}

function createInventoryService(db) {
  function readRecipe(id) {
    const row = db.prepare("SELECT * FROM menu_recipes WHERE id=?").get(id);
    if (!row) throw new OrderError("Recipe is not configured: "+id,409);
    return { ...row, terms: JSON.parse(row.terms_json) };
  }
  function recipeIssues(recipe) {
    return recipe.terms.flatMap(term => {
      const stock = db.prepare("SELECT * FROM inventory_items WHERE sku=?").get(term.sku);
      if (!stock) return ["Missing ingredient: "+term.sku];
      try { inStockUnits(term, stock, db); } catch (error) { return [error.message]; }
      return [];
    });
  }
  function requirements(items, takeout) {
    const amounts = new Map();
    function include(id, count, lessIce = false) {
      const recipe = readRecipe(id);
      const issues = recipeIssues(recipe);
      if (issues.length) throw new OrderError(recipe.label+": "+issues.join(" "),409);
      for (const term of recipe.terms) {
        const stock = db.prepare("SELECT * FROM inventory_items WHERE sku=?").get(term.sku);
        const amount = inStockUnits(term, stock, db) * count * (term.sku==="tube-ice" && lessIce ? 0.6 : 1);
        const previous = amounts.get(stock.id);
        amounts.set(stock.id, { ...stock, amount: (previous?.amount || 0) + amount });
      }
    }
    for (const item of items) {
      include(item.productId+"|"+item.variant,item.quantity,item.options["Ice Level"]==="Less Ice");
      const addon = item.options["Add-ons (worth ₱30)"];
      if (addon) include(addon==="Syrup-Sauce"?"@syrup|"+item.productId:"@addon|"+addon,item.quantity);
      if (item.category==="chicken-meals") include("@flavor|"+item.options.Flavors,item.quantity*(item.variant==="12pcs"?2:1));
      if (takeout && ["rice-meals","chicken-meals","snacks"].includes(item.category)) {
        include("@packaging|food",item.quantity);
        if (item.category==="rice-meals") include("@packaging|rice",item.quantity);
      }
    }
    if (takeout) include("@packaging|order",1);
    return [...amounts.values()].map(item => {
      const amount = round(item.amount);
      if (amount <= 0 || !Number.isFinite(amount)) {
        throw new OrderError("Review the measured conversion for "+item.product_name+". The deduction must be at least 0.001 "+item.measurement+".",409);
      }
      return { ...item, amount };
    });
  }
  function check(items, takeout) {
    const needed = requirements(items,takeout);
    for (const item of needed) {
      if (round(item.quantity) < item.amount) throw new OrderError(
        `Not enough ${item.product_name}. Need ${item.amount} ${item.measurement}; available ${round(item.quantity)} ${item.measurement}.`,409);
    }
    return needed;
  }
  function deduct(items, orderId, takeout) {
    const needed = check(items,takeout);
    for (const item of needed) {
      const changed = db.prepare("UPDATE inventory_items SET quantity=ROUND(quantity-?,3),updated_at=CURRENT_TIMESTAMP WHERE id=? AND ROUND(quantity,3)>=?")
        .run(item.amount,item.id,item.amount);
      if (!changed.changes) throw new OrderError("Stock changed. Please review the order again.",409);
      db.prepare("INSERT INTO order_stock_allocations(order_id,inventory_item_id,amount) VALUES(?,?,?)").run(orderId,item.id,item.amount);
      db.prepare("INSERT INTO inventory_transactions(inventory_item_id,order_id,change_amount,reason) VALUES(?,?,?,'Order stock reserved')")
        .run(item.id,orderId,-item.amount);
    }
  }
  function restore(orderId) {
    const allocations = db.prepare("SELECT * FROM order_stock_allocations WHERE order_id=? AND returned_amount<amount").all(orderId);
    for (const item of allocations) {
      const amount = round(item.amount-item.returned_amount);
      db.prepare("UPDATE inventory_items SET quantity=ROUND(quantity+?,3),updated_at=CURRENT_TIMESTAMP WHERE id=?").run(amount,item.inventory_item_id);
      db.prepare("UPDATE order_stock_allocations SET returned_amount=amount WHERE order_id=? AND inventory_item_id=?").run(orderId,item.inventory_item_id);
      db.prepare("INSERT INTO inventory_transactions(inventory_item_id,order_id,change_amount,reason) VALUES(?,?,?,'Canceled before preparation: stock returned')")
        .run(item.inventory_item_id,orderId,amount);
    }
  }
  function recipes() {
    return db.prepare("SELECT * FROM menu_recipes ORDER BY label").all().map(row => {
      const recipe = { id:row.id,label:row.label,terms:JSON.parse(row.terms_json) };
      return { ...recipe, issues:recipeIssues(recipe) };
    });
  }
  return { requirements,check,deduct,restore,recipes,readRecipe };
}
module.exports = { createInventoryService,validateTerms,lowStockLevel,round,inStockUnits };
