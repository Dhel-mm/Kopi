// Read-only readiness check. Does not seed data, deduct stock or create orders.
const path=require("node:path");
const Database=require("better-sqlite3");
require("dotenv").config({path:path.join(__dirname,"../.env"),quiet:true});
const {createInventoryService}=require("../services/inventory");
const {catalog}=require("../services/pricing");
const db=new Database(process.env.DATABASE_PATH||path.join(__dirname,"../data/kopi.db"),{readonly:true,fileMustExist:true});
try {
  const recipes=createInventoryService(db).recipes();
  const issues=recipes.filter(recipe=>recipe.issues.length).map(({label,issues})=>({label,issues}));
  const estimates=db.prepare("SELECT COUNT(*) AS count FROM inventory_unit_conversions c JOIN inventory_items i ON i.id=c.inventory_item_id WHERE c.is_estimate=1 AND i.is_archived=0").get().count;
  const outOfStock=db.prepare("SELECT product_name AS product FROM inventory_items WHERE quantity<=0 AND is_archived=0 ORDER BY product_name").all();
  console.log(JSON.stringify({
    menuProducts:catalog.products.length,recipeDefinitions:recipes.length,
    configurationIssues:issues,estimatedConversions:estimates,outOfStock
  },null,2));
  if(issues.length) process.exitCode=1;
} finally { db.close(); }
