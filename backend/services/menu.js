const seed = require("../../Customer/Catalog");
const { OrderError } = require("./errors");

// The live menu. It starts as the menu written in Customer/Catalog.js and is
// stored in the database, so the administrator can add, edit, hide or remove
// items in Menu Management. Prices, the customer menu and the cashier all read
// this one copy.
let current = build(seed.categories.map((category, index) => ({ ...category, position: index })));

function build(categories) {
  const list = categories.map(category => ({
    id: category.id, name: category.name, label: category.label || category.name,
    products: category.products.map(product => ({ available: true, ...product }))
  }));
  const products = list.flatMap(group => group.products.map(product => ({ ...product, category: group.id })));
  const findProduct = id => products.find(product => product.id === id);
  return { categories: list, products, findProduct };
}

function migrateMenu(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS menu_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS menu_products (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES menu_categories(id),
      position INTEGER NOT NULL DEFAULT 0,
      data_json TEXT NOT NULL,
      available INTEGER NOT NULL DEFAULT 1,
      archived INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_by INTEGER REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS menu_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mime TEXT NOT NULL,
      data BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  if (db.prepare("SELECT COUNT(*) AS n FROM menu_products").get().n === 0) {
    db.transaction(() => {
      seed.categories.forEach((category, categoryIndex) => {
        db.prepare("INSERT OR IGNORE INTO menu_categories(id,name,position) VALUES(?,?,?)").run(category.id, category.name, categoryIndex);
        category.products.forEach((product, productIndex) => {
          const { id, ...data } = product;
          db.prepare("INSERT OR IGNORE INTO menu_products(id,category_id,position,data_json) VALUES(?,?,?,?)")
            .run(id, category.id, productIndex, JSON.stringify(data));
        });
      });
    })();
  }
  load(db);
}

// Reads the database copy into memory. Without stored products the written menu stays.
function load(db) {
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='menu_products'").get();
  if (!hasTable || !db.prepare("SELECT 1 FROM menu_products LIMIT 1").get()) return current;
  const categories = db.prepare("SELECT * FROM menu_categories ORDER BY position, name").all();
  const rows = db.prepare("SELECT * FROM menu_products WHERE archived=0 ORDER BY position, rowid").all();
  current = build(categories.map(category => ({
    id: category.id, name: category.name,
    products: rows.filter(row => row.category_id === category.id)
      .map(row => ({ id: row.id, ...JSON.parse(row.data_json), available: row.available === 1 }))
  })).filter(category => category.products.length));
  return current;
}

function reset() {
  current = build(seed.categories);
}

// ---------- Checking what the administrator entered ----------
const KNOWN_KEYS = { "Size": "size", "Ice Level": "ice", "Flavors": "flavor", "Pieces": "pieces" };
const slug = value => String(value).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
function text(value, label, max, optional = false) {
  if (optional && (value == null || String(value).trim() === "")) return "";
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new OrderError(`Enter ${label} (up to ${max} characters).`);
  }
  return value.trim().replace(/\s+/g, " ");
}
function price(value, label) {
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number) || number <= 0 || number > 100000 ||
      Math.abs(number * 100 - Math.round(number * 100)) > 0.00001) {
    throw new OrderError(`Enter a price above ₱0 with at most two decimal places for ${label}.`);
  }
  return Math.round(number * 100) / 100;
}
function values(list, label) {
  if (!Array.isArray(list)) throw new OrderError(`Add choices for ${label}.`);
  const clean = list.map(value => text(value, `each choice for ${label}`, 60));
  if (!clean.length || clean.length > 20) throw new OrderError(`Give ${label} between 1 and 20 choices.`);
  if (new Set(clean.map(value => value.toLowerCase())).size !== clean.length) throw new OrderError(`Each choice for ${label} must be different.`);
  return clean;
}

// Turns the Menu Management form into the menu's product shape:
// prices by size/pieces, extra choices (ice level, flavors) and optional add-ons.
function productFromInput(input) {
  if (!input || typeof input !== "object") throw new OrderError("Invalid menu item.");
  const name = text(input.name, "a product name", 80);
  const description = text(input.description, "a description", 300, true);
  if (!["drink", "food"].includes(input.type)) throw new OrderError("Choose Drink or Food.");
  const sizes = Array.isArray(input.sizes) ? input.sizes : [];
  if (!sizes.length || sizes.length > 10) throw new OrderError("Add between 1 and 10 sizes with prices.");
  const prices = {};
  for (const size of sizes) {
    const sizeName = text(size?.name, "each size name", 40);
    if (Object.hasOwn(prices, sizeName)) throw new OrderError(`The size "${sizeName}" is listed twice.`);
    prices[sizeName] = price(size.price, sizeName);
  }
  const sizeNames = Object.keys(prices);
  const options = [];
  const single = sizeNames.length === 1 && sizeNames[0] === "Regular";
  if (!single) {
    const label = text(input.sizeLabel || "Size", "a name for the size choice", 30);
    const defaultValue = input.defaultSize ? text(input.defaultSize, "the default size", 40) : null;
    if (defaultValue && !sizeNames.includes(defaultValue)) throw new OrderError("Choose a default size from the list.");
    options.push({ key: KNOWN_KEYS[label] || slug(label) || "size", label, values: sizeNames, defaultValue, priceKey: true });
  }
  const choices = Array.isArray(input.choices) ? input.choices : [];
  if (choices.length > 5) throw new OrderError("Add at most 5 extra choices.");
  for (const choice of choices) {
    const label = text(choice?.label, "a name for each extra choice", 30);
    const list = values(choice.values, label);
    const defaultValue = choice.defaultValue ? text(choice.defaultValue, `the default for ${label}`, 60) : list[0];
    if (!list.includes(defaultValue)) throw new OrderError(`Choose a default for ${label} from its choices.`);
    options.push({ key: KNOWN_KEYS[label] || slug(label), label, values: list, defaultValue, priceKey: false });
  }
  if (input.addOns && Array.isArray(input.addOns.values) && input.addOns.values.length) {
    const addOnPrice = price(input.addOns.price, "add-ons");
    options.push({ key: "addons", label: `Add-ons (worth ₱${addOnPrice})`, values: values(input.addOns.values, "add-ons"),
      defaultValue: null, priceKey: false, addOnPrice });
  }
  const keys = options.map(option => option.key);
  if (keys.some(key => !key) || new Set(keys).size !== keys.length) throw new OrderError("Each choice needs a different name.");
  return { name, description, type: input.type, customizable: true, prices, options };
}

function createMenuService(db) {
  function list() {
    const categories = db.prepare("SELECT * FROM menu_categories ORDER BY position, name").all();
    const rows = db.prepare(`SELECT p.* FROM menu_products p JOIN menu_categories c ON c.id=p.category_id
      ORDER BY c.position, c.name, p.position, p.rowid`).all();
    const item = row => ({ id: row.id, ...JSON.parse(row.data_json), category: row.category_id,
      available: row.available === 1, archived: row.archived === 1, updatedAt: row.updated_at });
    return {
      categories: categories.map(category => ({ id: category.id, name: category.name })),
      products: rows.filter(row => !row.archived).map(item),
      archived: rows.filter(row => row.archived).map(item)
    };
  }
  function category(input) {
    if (input.newCategory) {
      const name = text(input.newCategory, "a category name", 40);
      const id = slug(name);
      if (!id) throw new OrderError("Enter a category name with letters or numbers.");
      const existing = db.prepare("SELECT id FROM menu_categories WHERE id=? OR lower(name)=lower(?)").get(id, name);
      if (existing) return existing.id;
      const position = db.prepare("SELECT COALESCE(MAX(position),-1)+1 AS n FROM menu_categories").get().n;
      db.prepare("INSERT INTO menu_categories(id,name,position) VALUES(?,?,?)").run(id, name, position);
      return id;
    }
    const found = db.prepare("SELECT id FROM menu_categories WHERE id=?").get(input.category);
    if (!found) throw new OrderError("Choose a category.");
    return found.id;
  }
  // Uploaded photos are stored in the database and served from /Customer/MenuImages/.
  function image(input, fallback) {
    if (!input.imageData) {
      if (fallback) return fallback;
      throw new OrderError("Add a photo of the item.");
    }
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(input.imageData));
    if (!match) throw new OrderError("Upload a PNG, JPEG or WebP photo.");
    const data = Buffer.from(match[2], "base64");
    if (!data.length || data.length > 1024 * 1024) throw new OrderError("Use a photo up to 1 MB.");
    const signature = data.subarray(0, 12).toString("hex");
    const valid = match[1] === "image/png" ? signature.startsWith("89504e47")
      : match[1] === "image/jpeg" ? signature.startsWith("ffd8ff")
      : signature.startsWith("52494646") && signature.endsWith("57454250");
    if (!valid) throw new OrderError("The photo file is damaged or not the type it says.");
    const id = db.prepare("INSERT INTO menu_images(mime,data) VALUES(?,?)").run(match[1], data).lastInsertRowid;
    return `MenuImages/${id}`;
  }
  // Every size needs a recipe so stock is deducted. New sizes start empty and
  // cannot be ordered until the recipe is set in Inventory > Recipe setup.
  function ensureRecipes(id, product) {
    for (const variant of Object.keys(product.prices)) {
      db.prepare(`INSERT INTO menu_recipes(id,label,terms_json) VALUES(?,?,'[]')
        ON CONFLICT(id) DO UPDATE SET label=excluded.label`).run(`${id}|${variant}`, `${product.name} — ${variant}`);
    }
  }
  // Ingredients entered while adding or editing the item, so nobody has to go to
  // Inventory first. Each row names an existing ingredient or a new one, with the
  // amount each size uses. New ingredients are added to Inventory here.
  function saveIngredients(id, product, rows, user) {
    if (rows == null) return;
    const { addInventoryItem, validateTerms } = require("./inventory");
    if (!Array.isArray(rows) || !rows.length || rows.length > 40) throw new OrderError("Add 1 to 40 ingredients.");
    const seen = new Set();
    const resolved = rows.map(row => {
      if (!row || typeof row !== "object" || !row.amounts || typeof row.amounts !== "object") throw new OrderError("Complete each ingredient row.");
      if (row.newIngredient) {
        const fresh = row.newIngredient;
        const name = text(fresh.name, "the new ingredient's name", 100);
        const base = slug(name) || "ingredient";
        let sku = base;
        for (let n = 2; db.prepare("SELECT 1 FROM inventory_items WHERE sku=?").get(sku); n++) sku = `${base}-${n}`;
        addInventoryItem(db, { sku, productName: name, category: text(fresh.category, "the new ingredient's category", 100),
          measurement: fresh.measurement, quantity: fresh.quantity, initialQuantity: fresh.packageQuantity, packageUnit: "package" });
        return { sku, unit: fresh.measurement, amounts: row.amounts };
      }
      const key = `${row.sku}|${row.unit}`;
      if (seen.has(key)) throw new OrderError("The same ingredient is listed twice. Keep one row for each ingredient.");
      seen.add(key);
      return { sku: row.sku, unit: row.unit, amounts: row.amounts };
    });
    for (const variant of Object.keys(product.prices)) {
      const terms = resolved.filter(row => row.amounts[variant] != null && row.amounts[variant] !== "" && row.amounts[variant] !== 0)
        .map(row => ({ sku: row.sku, unit: row.unit, amount: row.amounts[variant] }));
      if (!terms.length) throw new OrderError(`Enter at least one ingredient amount for ${variant}.`);
      db.prepare("UPDATE menu_recipes SET terms_json=?,updated_at=CURRENT_TIMESTAMP,updated_by=? WHERE id=?")
        .run(JSON.stringify(validateTerms(terms, db)), user.id, `${id}|${variant}`);
    }
  }
  function create(input, user) {
    const product = productFromInput(input);
    return db.transaction(() => {
      const categoryId = category(input);
      let id = slug(product.name) || "item";
      for (let n = 2; db.prepare("SELECT 1 FROM menu_products WHERE id=?").get(id); n++) id = `${slug(product.name)}-${n}`;
      product.image = image(input);
      const position = db.prepare("SELECT COALESCE(MAX(position),-1)+1 AS n FROM menu_products WHERE category_id=?").get(categoryId).n;
      db.prepare("INSERT INTO menu_products(id,category_id,position,data_json,available,updated_by) VALUES(?,?,?,?,?,?)")
        .run(id, categoryId, position, JSON.stringify(product), input.available === false ? 0 : 1, user.id);
      ensureRecipes(id, product);
      saveIngredients(id, product, input.ingredients, user);
      load(db);
      return { id, ...product, category: categoryId, available: input.available !== false };
    }).immediate();
  }
  function update(id, input, user) {
    const product = productFromInput(input);
    return db.transaction(() => {
      const row = db.prepare("SELECT * FROM menu_products WHERE id=? AND archived=0").get(id);
      if (!row) throw new OrderError("Menu item was not found.", 404);
      const categoryId = category(input);
      product.image = image(input, JSON.parse(row.data_json).image);
      const position = categoryId === row.category_id ? row.position
        : db.prepare("SELECT COALESCE(MAX(position),-1)+1 AS n FROM menu_products WHERE category_id=?").get(categoryId).n;
      db.prepare(`UPDATE menu_products SET category_id=?,position=?,data_json=?,available=?,updated_at=CURRENT_TIMESTAMP,updated_by=? WHERE id=?`)
        .run(categoryId, position, JSON.stringify(product), input.available === false ? 0 : 1, user.id, id);
      ensureRecipes(id, product);
      saveIngredients(id, product, input.ingredients, user);
      load(db);
      return { id, ...product, category: categoryId, available: input.available !== false };
    }).immediate();
  }
  function setAvailable(id, available, user) {
    if (typeof available !== "boolean") throw new OrderError("Choose available or unavailable.");
    const changed = db.prepare("UPDATE menu_products SET available=?,updated_at=CURRENT_TIMESTAMP,updated_by=? WHERE id=? AND archived=0")
      .run(available ? 1 : 0, user.id, id);
    if (!changed.changes) throw new OrderError("Menu item was not found.", 404);
    load(db);
    return { id, available };
  }
  // Archiving keeps past orders and reports intact; the item just leaves the menu
  // until it is restored.
  function archive(id, archived, user) {
    if (typeof archived !== "boolean") throw new OrderError("Choose archive or restore.");
    const changed = db.prepare("UPDATE menu_products SET archived=?,updated_at=CURRENT_TIMESTAMP,updated_by=? WHERE id=? AND archived=?")
      .run(archived ? 1 : 0, user.id, id, archived ? 0 : 1);
    if (!changed.changes) throw new OrderError(archived ? "Menu item was not found." : "Archived item was not found.", 404);
    load(db);
    return { id, archived };
  }
  function imageFile(id) {
    return db.prepare("SELECT mime,data FROM menu_images WHERE id=?").get(Number(id)) || null;
  }
  // A new, empty category; items are added to it with Add New Item.
  function addCategory(input) {
    if (!input?.name) throw new OrderError("Enter a category name.");
    const existing = db.prepare("SELECT id FROM menu_categories WHERE lower(name)=lower(?)").get(String(input.name).trim());
    if (existing) throw new OrderError("That category already exists.", 409);
    const id = db.transaction(() => category({ newCategory: input.name })).immediate();
    load(db);
    return db.prepare("SELECT id,name FROM menu_categories WHERE id=?").get(id);
  }
  return { list, create, update, setAvailable, archive, addCategory, imageFile };
}

module.exports = { current: () => current, load, reset, migrateMenu, createMenuService, productFromInput };
