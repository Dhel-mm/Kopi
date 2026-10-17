const { OrderError, money } = require("./pricing");

function normalizeCode(value) {
  if (typeof value !== "string") throw new OrderError("Enter a voucher code.");
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code)) {
    throw new OrderError("Use 3–32 letters, numbers, hyphens or underscores for the voucher code.");
  }
  return code;
}

function migrateVouchers(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS vouchers (
    code TEXT PRIMARY KEY COLLATE NOCASE,
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0 AND amount_cents <= 100000000),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  if (!db.prepare("PRAGMA table_info(vouchers)").all().some(column => column.name === "removed_at")) {
    db.exec("ALTER TABLE vouchers ADD COLUMN removed_at TEXT");
  }
  // Preserve the existing promotion; never overwrite admin edits or activation.
  db.prepare("INSERT OR IGNORE INTO vouchers(code,amount_cents) VALUES('KOPI10',1000)").run();
  db.exec(`CREATE TABLE IF NOT EXISTS voucher_redemptions (
    voucher_code TEXT PRIMARY KEY COLLATE NOCASE REFERENCES vouchers(code),
    order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    redeemed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}

function createVoucherService(db) {
  migrateVouchers(db);
  const list = () => db.prepare(`SELECT v.code,v.amount_cents / 100.0 AS amount,
    v.active,v.updated_at AS updatedAt,r.order_id AS redeemedOrderId,
    r.redeemed_at AS redeemedAt
    FROM vouchers v LEFT JOIN voucher_redemptions r ON r.voucher_code=v.code
    WHERE v.removed_at IS NULL ORDER BY v.active DESC,v.code`).all()
    .map(row => ({...row, active: Boolean(row.active), used: Boolean(row.redeemedOrderId)}));

  function resolve(code) {
    const normalizedCode = normalizeCode(code);
    const row = db.prepare(`SELECT v.amount_cents,v.active,v.removed_at,r.order_id AS redeemedOrderId
      FROM vouchers v LEFT JOIN voucher_redemptions r ON r.voucher_code=v.code
      WHERE v.code=?`).get(normalizedCode);
    if (row?.redeemedOrderId) throw new OrderError("This voucher has already been used.", 409);
    if (!row || !row.active || row.removed_at) throw new OrderError("That voucher code is not valid or is inactive.");
    return row.amount_cents;
  }

  function redeem(code, orderId, userId) {
    if (!code) return;
    try {
      db.prepare(`INSERT INTO voucher_redemptions(voucher_code,order_id,user_id)
        VALUES(?,?,?)`).run(normalizeCode(code), orderId, userId);
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_PRIMARYKEY" || error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new OrderError("This voucher has already been used.", 409);
      }
      throw error;
    }
  }

  function save(input, existingCode) {
    const code = normalizeCode(existingCode ?? input.code);
    const amount = money(input.amount, "Voucher deduction");
    if (amount <= 0) throw new OrderError("Voucher deduction must be greater than zero.");
    if (typeof input.active !== "boolean") throw new OrderError("Choose whether the voucher is active.");
    if (existingCode !== undefined) {
      const result = db.prepare("UPDATE vouchers SET amount_cents=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE code=? AND removed_at IS NULL")
        .run(amount, Number(input.active), code);
      if (!result.changes) throw new OrderError("Voucher was not found.", 404);
    } else {
      try {
        db.prepare("INSERT INTO vouchers(code,amount_cents,active) VALUES(?,?,?)").run(code, amount, Number(input.active));
      } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_PRIMARYKEY" || error.code === "SQLITE_CONSTRAINT_UNIQUE") {
          throw new OrderError("That voucher code already exists. Edit it instead.", 409);
        }
        throw error;
      }
    }
    return list().find(row => row.code === code);
  }
  function remove(value) {
    const code = normalizeCode(value);
    // Hide the voucher without erasing its one-time redemption or order history.
    const result = db.prepare(`UPDATE vouchers SET active=0,removed_at=COALESCE(removed_at,CURRENT_TIMESTAMP),
      updated_at=CURRENT_TIMESTAMP WHERE code=?`).run(code);
    if (!result.changes) throw new OrderError("Voucher was not found.", 404);
    return {message: "Voucher removed. Its redemption history is preserved."};
  }
  return {list, resolve, redeem, save, remove};
}

module.exports = {createVoucherService, migrateVouchers};
