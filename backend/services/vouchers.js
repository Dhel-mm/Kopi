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
  // Preserve the existing promotion; never overwrite admin edits or activation.
  db.prepare("INSERT OR IGNORE INTO vouchers(code,amount_cents) VALUES('KOPI10',1000)").run();
}

function createVoucherService(db) {
  migrateVouchers(db);
  const list = () => db.prepare(`SELECT code,amount_cents / 100.0 AS amount,
    active,updated_at AS updatedAt FROM vouchers ORDER BY active DESC,code`).all()
    .map(row => ({...row, active: Boolean(row.active)}));

  function resolve(code) {
    const row = db.prepare("SELECT amount_cents FROM vouchers WHERE code=? AND active=1").get(normalizeCode(code));
    if (!row) throw new OrderError("That voucher code is not valid or is inactive.");
    return row.amount_cents;
  }

  function save(input, existingCode) {
    const code = normalizeCode(existingCode ?? input.code);
    const amount = money(input.amount, "Voucher deduction");
    if (amount <= 0) throw new OrderError("Voucher deduction must be greater than zero.");
    if (typeof input.active !== "boolean") throw new OrderError("Choose whether the voucher is active.");
    if (existingCode !== undefined) {
      const result = db.prepare("UPDATE vouchers SET amount_cents=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE code=?")
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
  return {list, resolve, save};
}

module.exports = {createVoucherService, migrateVouchers};
