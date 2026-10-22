function migrateManualPayments(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(orders)").all().map(column => column.name));
  if (!columns.has("payment_reference")) {
    db.exec("ALTER TABLE orders ADD COLUMN payment_reference TEXT");
  }
  if (!columns.has("payment_status")) {
    db.exec("ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'Unpaid'");
    db.exec("UPDATE orders SET payment_status = 'Pending verification' WHERE payment = 'GCash'");
  }
  if (!columns.has("payment_verified_at")) {
    db.exec("ALTER TABLE orders ADD COLUMN payment_verified_at TEXT");
  }
  if (!columns.has("payment_verified_by")) {
    db.exec("ALTER TABLE orders ADD COLUMN payment_verified_by INTEGER REFERENCES users(id)");
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS orders_gcash_reference_unique
    ON orders(payment_reference)
    WHERE payment = 'GCash' AND payment_reference IS NOT NULL
  `);
}

function parseManualPayment(payment, reference) {
  if (!["Cash", "GCash"].includes(payment)) {
    throw new Error("Choose Cash or GCash as your payment method.");
  }
  if (payment === "Cash") {
    return { payment, reference: null, status: "Unpaid" };
  }
  const cleanReference = typeof reference === "string" ? reference.trim() : "";
  // Current GCash receipts show a purely numeric 13-digit Ref. No.
  if (!/^[0-9]{13}$/.test(cleanReference)) {
    throw new Error("Enter the 13-digit GCash reference number (numbers only) from your receipt.");
  }
  // A reference number is a claim to be checked by staff, never proof of payment.
  return { payment, reference: cleanReference, status: "Pending verification" };
}

module.exports = { migrateManualPayments, parseManualPayment };
