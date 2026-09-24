const path = require("path");
const fs = require("node:fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const databasePath = process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : path.join(__dirname, "data", "kopi.db");
fs.mkdirSync(path.dirname(databasePath), { recursive:true });
const db = new Database(databasePath);

db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    middle_name TEXT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    phone TEXT,
    role TEXT NOT NULL DEFAULT 'Customer',
    status TEXT NOT NULL DEFAULT 'Active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    order_type TEXT NOT NULL DEFAULT 'Online',
    status TEXT NOT NULL DEFAULT 'New',
    payment TEXT NOT NULL DEFAULT 'Cash',
    address TEXT,
    phone TEXT,
    voucher TEXT,
    subtotal REAL NOT NULL DEFAULT 0,
    delivery_fee REAL NOT NULL DEFAULT 0,
    voucher_discount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    canceled_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    price REAL NOT NULL,
    options_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  );
`);

const orderColumns = new Set(
  db.prepare("PRAGMA table_info(orders)").all().map(column => column.name)
);

if (!orderColumns.has("customer_name")) {
  db.exec("ALTER TABLE orders ADD COLUMN customer_name TEXT");
}

if (!orderColumns.has("service_type")) {
  db.exec("ALTER TABLE orders ADD COLUMN service_type TEXT");
}

require("./services/manualPayment").migrateManualPayments(db);

db.exec(`
  CREATE TABLE IF NOT EXISTS inventory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL UNIQUE,
    product_name TEXT NOT NULL,
    category TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0,
    measurement TEXT NOT NULL,
    initial_quantity REAL NOT NULL,
    low_stock_level REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS product_recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_product_id TEXT NOT NULL,
    inventory_item_id INTEGER NOT NULL,
    amount_required REAL NOT NULL,
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id),
    UNIQUE (menu_product_id, inventory_item_id)
  );

  CREATE TABLE IF NOT EXISTS inventory_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inventory_item_id INTEGER NOT NULL,
    order_id INTEGER,
    change_amount REAL NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id),
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    improve_comment TEXT NOT NULL,
    liked_comment TEXT NOT NULL,
    visit_frequency TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

require("./services/orderSchema").migrateOrderWorkflow(db);
require("./services/accountSchema").migrateAccounts(db);

const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const existingAdmin = db
  .prepare("SELECT id FROM users WHERE role = 'Admin' LIMIT 1")
  .get();

if (!existingAdmin) {
  if (!adminEmail || !process.env.ADMIN_PASSWORD) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD before creating the first administrator.");
  require("./services/accounts").email(adminEmail);
  require("./services/accounts").password(process.env.ADMIN_PASSWORD);
  const passwordHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);

  db.prepare(`
    INSERT INTO users (
      first_name, last_name, email, password_hash, role, status
    ) VALUES (?, ?, ?, ?, 'Admin', 'Active')
  `).run("Admin", "Kopi;", adminEmail, passwordHash);

  console.log("Admin account created.");
}

if (require.main === module) {
  console.log(`Database ready: ${databasePath}`);
}

module.exports = db;
