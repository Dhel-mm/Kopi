const path = require("node:path");
const Database = require("better-sqlite3");
const { copyDatabase } = require("../services/backups");
const { items: catalogItems } = require("../catalog/inventory-2026-09.json");

require("dotenv").config({
  path: path.join(__dirname, "../.env"),
  quiet: true
});

const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(__dirname, "../data/kopi.db");

const apply = process.argv.includes("--apply");
const openingQuantities = new Map(
  catalogItems.map(item => [item.sku, item.quantity])
);

function openingStockFor(item) {
  // Catalog amounts are the approved opening stock. Supplies added outside the
  // catalog receive enough whole packages for a usable school demonstration.
  return Math.max(
    openingQuantities.get(item.sku) ?? item.initial_quantity * 10,
    item.initial_quantity * 2,
    item.low_stock_level * 2,
    1
  );
}

async function main() {
  // Preview mode opens the existing database read-only.
  const db = new Database(databasePath, {
    readonly: !apply,
    fileMustExist: true
  });

  try {
    db.pragma("foreign_keys = ON");

    if (
      db.pragma("integrity_check", { simple: true }) !== "ok" ||
      db.pragma("foreign_key_check").length > 0
    ) {
      throw new Error("Database checks failed. Nothing was removed.");
    }

    const adminCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM users
      WHERE role = 'Admin' AND status = 'Active'
    `).get().count;

    if (adminCount === 0) {
      throw new Error("Keep an active Admin account before cleaning.");
    }

    const history = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM orders) AS orders,
        (SELECT COUNT(*) FROM order_items) AS orderItems,
        (SELECT COUNT(*) FROM inventory_transactions) AS stockMovements,
        (SELECT COUNT(*) FROM feedback) AS feedback,
        (SELECT COUNT(*) FROM voucher_redemptions) AS voucherUses,
        (SELECT COUNT(*) FROM users) AS accounts
    `).get();

    const activeInventory = db.prepare(`
      SELECT id, sku, quantity, initial_quantity, low_stock_level
      FROM inventory_items
      WHERE is_archived = 0
    `).all();

    console.log("Database:", databasePath);
    console.log("Orders to remove:", history.orders);
    console.log("Order items to remove:", history.orderItems);
    console.log("Stock movements to remove:", history.stockMovements);
    console.log("Feedback records to remove:", history.feedback);
    console.log("Voucher uses to remove:", history.voucherUses);
    console.log("Accounts preserved:", history.accounts);
    console.log("Active inventory items to restock:", activeInventory.length);

    if (!apply) {
      console.log("\nPREVIEW ONLY. No records were changed.");
      return;
    }

    // Make another verified backup immediately before deletion.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(
      path.dirname(databasePath),
      "backups",
      `before-cleanup-${stamp}.db`
    );

    await copyDatabase(databasePath, backupPath);
    console.log("Safety backup:", backupPath);

    const cleanup = db.transaction(() => {
      // Keep accounts, menu setup, recipes, and voucher definitions. Clear only
      // activity history, including voucher usage and stock movement logs.
      db.exec(`
        DELETE FROM voucher_redemptions;
        DELETE FROM inventory_transactions;
        DELETE FROM order_stock_allocations;
        DELETE FROM order_items;
        DELETE FROM orders;
        DELETE FROM feedback;
        DELETE FROM password_resets;
        DELETE FROM account_audit;
        DELETE FROM request_limits;

        DELETE FROM sqlite_sequence
        WHERE name IN (
          'orders', 'order_items', 'inventory_transactions', 'feedback',
          'password_resets', 'account_audit'
        );
      `);

      const restock = db.prepare(`
        UPDATE inventory_items
        SET quantity = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      for (const item of activeInventory) {
        restock.run(openingStockFor(item), item.id);
      }

      if (db.pragma("foreign_key_check").length > 0) {
        throw new Error("Relationship check failed. Cleanup rolled back.");
      }
    });

    cleanup.immediate();

    console.log("\nCleanup completed.");
    console.log("All accounts were kept, and active inventory was restocked.");
    console.log("Keep the safety backup in case you need to undo this.");
  } finally {
    db.close();
  }
}

main().catch(error => {
  console.error("Cleanup stopped:", error.message);
  process.exitCode = 1;
});
