const express = require("express");
const { authFor,requireRole } = require("../middleware/auth");
const { createInventoryService,addInventoryItem,validateTerms,lowStockLevel,round,stockLevels } = require("../services/inventory");
const { OrderError } = require("../services/pricing");
const { sendError } = require("../services/orderWorkflow");
const { packageDefinition } = require("../services/inventoryPackages");

function quantity(value,allowZero=true) {
  if (typeof value!=="number" || !Number.isFinite(value) || value<0 ||
      (!allowZero && value===0) || value>100000000 || round(value)!==value) {
    throw new OrderError("Enter a valid quantity with up to 3 decimal places.");
  }
  return value;
}
module.exports = function inventoryRouter(db) {
  const router = express.Router();
  const requireAuth = authFor(db);
  const service = createInventoryService(db);
  router.use(requireAuth,requireRole("Admin"));
  router.get("/",(req,res)=>{
    const items = stockLevels(db).map(({item,level})=>({id:item.id,sku:item.sku,productName:item.product_name,category:item.category,
        quantity:level.quantity,measurement:item.measurement,initialQuantity:item.initial_quantity,
        packageUnit:item.package_unit,lowStockLevel:level.reorderLevel,...level}));
    res.json({items});
  });
  // Low-stock parameters: lead time, safety days and an optional manual level.
  router.patch("/:id/reorder-settings",(req,res)=>{
    try {
      const b=req.body||{};
      const days=(value,label,max)=>{
        if (typeof value!=="number"||!Number.isFinite(value)||value<0||value>max||Math.round(value*10)!==value*10) {
          throw new OrderError(`${label} must be from 0 to ${max} days (up to one decimal place).`);
        }
        return value;
      };
      const leadTime=days(b.leadTimeDays,"Lead time",60);
      const safety=days(b.safetyDays,"Safety stock",30);
      const manual=b.reorderLevel===null||b.reorderLevel===""||b.reorderLevel===undefined?null:quantity(b.reorderLevel);
      const changed=db.prepare(`UPDATE inventory_items SET lead_time_days=?,safety_days=?,reorder_level_override=?,
        updated_at=CURRENT_TIMESTAMP WHERE id=? AND is_archived=0`).run(leadTime,safety,manual,req.params.id);
      if (!changed.changes) throw new OrderError("Inventory item was not found.",404);
      const saved=stockLevels(db).find(row=>row.item.id===Number(req.params.id));
      res.json({message:"Low-stock settings saved.",item:saved?.level});
    } catch(error) { sendError(res,error); }
  });
  router.get("/recipes",(req,res)=>res.json({recipes:service.recipes()}));
  router.put("/package-conversion/:sku",(req,res)=>{
    try {
      db.transaction(()=>{
        const item = db.prepare("SELECT * FROM inventory_items WHERE sku=? AND is_archived=0").get(req.params.sku);
        if (!item) throw new OrderError("Inventory product was not found.",404);
        const {capacity,label} = packageDefinition(item,req.body || {});
        const low = lowStockLevel({...item,initial_quantity:capacity});
        db.prepare(`UPDATE inventory_items SET initial_quantity=?,package_unit=?,low_stock_level=?,
          updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(capacity,label,low,item.id);
      }).immediate();
      res.json({message:"Package conversion saved. Remaining ingredient measurement is unchanged."});
    } catch(error) {sendError(res,error);}
  });
  router.get("/unit-conversions",(req,res)=>{
    const conversions = db.prepare(`
      SELECT c.inventory_item_id AS itemId, i.sku, i.product_name AS productName,
        c.recipe_unit AS recipeUnit, c.recipe_amount AS recipeAmount,
        c.stock_unit AS stockUnit, c.stock_amount AS stockAmount, c.is_estimate AS isEstimate
      FROM inventory_unit_conversions c JOIN inventory_items i ON i.id=c.inventory_item_id WHERE i.is_archived=0
      ORDER BY i.product_name,c.recipe_unit
    `).all();
    res.json({conversions});
  });
  router.put("/unit-conversions/:sku/:unit",(req,res)=>{
    try {
      const recipeAmount = quantity(req.body?.recipeAmount,false);
      const stockAmount = quantity(req.body?.stockAmount,false);
      const recipeUnit = req.params.unit;
      if (!["g","ml","pcs"].includes(recipeUnit)) throw new OrderError("Choose g, ml or pcs as the recipe unit.");
      const item = db.prepare("SELECT * FROM inventory_items WHERE sku=? AND is_archived=0").get(req.params.sku);
      if (!item) throw new OrderError("Inventory product was not found.",404);
      if (item.measurement === recipeUnit) throw new OrderError("These units already match; no conversion is needed.");
      if (req.body?.confirmedMeasured !== true) throw new OrderError("Confirm that these amounts were measured for this ingredient.");
      db.prepare(`
        INSERT INTO inventory_unit_conversions(inventory_item_id,recipe_unit,recipe_amount,stock_unit,stock_amount,updated_by)
        VALUES(?,?,?,?,?,?)
        ON CONFLICT(inventory_item_id,recipe_unit) DO UPDATE SET
          recipe_amount=excluded.recipe_amount,stock_unit=excluded.stock_unit,
          stock_amount=excluded.stock_amount,is_estimate=0,updated_at=CURRENT_TIMESTAMP,updated_by=excluded.updated_by
      `).run(item.id,recipeUnit,recipeAmount,item.measurement,stockAmount,req.user.id);
      res.json({message:"Measured conversion saved. Existing stock and order deductions were not changed."});
    } catch(error) { sendError(res,error); }
  });
  router.put("/recipes/:id",(req,res)=>{
    try {
      const recipe = service.readRecipe(req.params.id);
      const terms = validateTerms(req.body?.terms,db);
      db.prepare("UPDATE menu_recipes SET terms_json=?,updated_at=CURRENT_TIMESTAMP,updated_by=? WHERE id=?")
        .run(JSON.stringify(terms),req.user.id,recipe.id);
      res.json({message:"Recipe saved. New orders will use these quantities; existing allocations are unchanged."});
    } catch(error) { sendError(res,error); }
  });
  router.get("/:id/movements",(req,res)=>{
    const movements = db.prepare(`SELECT m.id,m.change_amount AS changeAmount,m.reason,m.created_at AS createdAt,
      o.order_number AS orderNumber FROM inventory_transactions m LEFT JOIN orders o ON o.id=m.order_id
      WHERE m.inventory_item_id=? ORDER BY m.id DESC`).all(req.params.id);
    res.json({movements});
  });
  for (const mode of ["add-stock","set-stock"]) router.patch("/:id/"+mode,(req,res)=>{
    try {
      const value = quantity(mode==="add-stock"?req.body?.amount:req.body?.quantity,mode==="set-stock");
      db.transaction(()=>{
        const item = db.prepare("SELECT * FROM inventory_items WHERE id=? AND is_archived=0").get(req.params.id);
        if (!item) throw new OrderError("Inventory item was not found.",404);
        const next = mode==="add-stock"?round(item.quantity+value):value;
        quantity(next);
        const change = round(next-item.quantity);
        db.prepare("UPDATE inventory_items SET quantity=?,low_stock_level=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(next,lowStockLevel(item),item.id);
        if (change) db.prepare("INSERT INTO inventory_transactions(inventory_item_id,change_amount,reason) VALUES(?,?,?)")
          .run(item.id,change,mode==="add-stock"?"Admin stock added":"Admin set stock");
      }).immediate();
      res.json({message:"Stock updated successfully."});
    } catch(error) { sendError(res,error); }
  });
  router.post("/",(req,res)=>{
    try {
      const id=db.transaction(()=>addInventoryItem(db,req.body||{})).immediate();
      res.status(201).json({id,message:"Inventory product added."});
    } catch(error) { sendError(res,error); }
  });
  return router;
};
