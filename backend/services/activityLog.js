// Records of user movements: who changed what, and when (Admin > User Activity).
// One middleware watches every successful change, so a new page or button that
// uses these routes is recorded without touching the page. Passwords, codes and
// tokens are never written here: only the fields named below are ever used.
function migrateActivityLog(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_name TEXT NOT NULL,
    role TEXT NOT NULL,
    area TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS activity_log_time ON activity_log(id DESC);`);
}

function record(db, user, area, action, details = "") {
  const person = db.prepare("SELECT first_name,last_name,role FROM users WHERE id=?").get(user.id);
  if (!person) return;
  db.prepare("INSERT INTO activity_log(user_id,user_name,role,area,action,details) VALUES(?,?,?,?,?,?)")
    .run(user.id, `${person.first_name} ${person.last_name}`, person.role, area, action, String(details).slice(0, 500));
}

function describer(db) {
  const orderNumber = id => db.prepare("SELECT order_number FROM orders WHERE id=?").get(id)?.order_number || `#${id}`;
  const stockItem = id => db.prepare("SELECT product_name,measurement FROM inventory_items WHERE id=?").get(id);
  const product = id => db.prepare("SELECT data_json FROM menu_products WHERE id=?").get(id);
  const productName = id => { const row = product(id); return row ? JSON.parse(row.data_json).name : id; };
  const person = id => { const row = db.prepare("SELECT first_name,last_name,email FROM users WHERE id=?").get(id); return row ? `${row.first_name} ${row.last_name} (${row.email})` : `#${id}`; };
  const orderActions = {
    "verify-payment": "Verified GCash payment", "reject-payment": "Marked GCash as not received",
    "verify-id": "Verified Senior Citizen / PWD ID", "not-approve-id": "Did not approve Senior Citizen / PWD ID",
    "balance-gcash": "Recorded remaining balance paid by GCash", "reject": "Rejected order", "delivery": "Sent delivery details"
  };
  // [method, path, how to describe it]. A null description means "do not record".
  const rules = [
    ["POST", /^\/api\/auth\/login$/, (m, req, res) => ["Account", "Logged in", ""]],
    ["POST", /^\/api\/auth\/logout$/, () => ["Account", "Logged out", ""]],
    ["PATCH", /^\/api\/me\/password$/, () => ["Account", "Changed own password", ""]],
    ["PUT", /^\/api\/me$/, () => ["Account", "Updated own profile", ""]],
    ["POST", /^\/api\/orders$/, (m, req, res) => ["Orders", "Placed online order", res?.orderNumber || ""]],
    ["PATCH", /^\/api\/orders\/(\d+)\/cancel$/, m => ["Orders", "Canceled order", orderNumber(m[1])]],
    ["POST", /^\/api\/workforce\/orders$/, (m, req, res) => ["Orders", "Placed in-store order", res?.orderNumber || ""]],
    ["PATCH", /^\/api\/workforce\/preparation\/(\d+)\/status$/, (m, req) => ["Orders", "Changed order status", `${orderNumber(m[1])} to ${req.body?.status}`]],
    [null, /^\/api\/(?:admin\/orders|workforce\/preparation|workforce\/verifications)\/(\d+)\/([a-z-]+)$/, m => orderActions[m[2]] ? ["Orders", orderActions[m[2]], orderNumber(m[1])] : null],
    ["PATCH", /^\/api\/admin\/inventory\/(\d+)\/add-stock$/, (m, req) => { const item = stockItem(m[1]); return ["Inventory", "Added stock", `${item?.product_name}: +${req.body?.amount} ${item?.measurement}`]; }],
    ["PATCH", /^\/api\/admin\/inventory\/(\d+)\/set-stock$/, (m, req) => { const item = stockItem(m[1]); return ["Inventory", "Set stock", `${item?.product_name}: ${req.body?.quantity} ${item?.measurement}`]; }],
    ["PATCH", /^\/api\/admin\/inventory\/(\d+)\/reorder-settings$/, m => ["Inventory", "Changed low-stock settings", stockItem(m[1])?.product_name]],
    ["POST", /^\/api\/admin\/inventory$/, (m, req) => ["Inventory", "Added inventory item", req.body?.productName]],
    ["PUT", /^\/api\/admin\/inventory\/recipes\/(.+)$/, m => ["Inventory", "Changed recipe", decodeURIComponent(m[1])]],
    ["PUT", /^\/api\/admin\/inventory\/package-conversion\/(.+)$/, m => ["Inventory", "Changed package size", decodeURIComponent(m[1])]],
    ["PUT", /^\/api\/admin\/inventory\/unit-conversions\/(.+)$/, m => ["Inventory", "Changed unit conversion", decodeURIComponent(m[1])]],
    ["POST", /^\/api\/admin\/menu\/categories$/, (m, req) => ["Menu", "Added menu category", req.body?.name]],
    ["POST", /^\/api\/admin\/menu\/products$/, (m, req) => ["Menu", "Added menu item", req.body?.name]],
    ["PUT", /^\/api\/admin\/menu\/products\/(.+)$/, (m, req) => ["Menu", "Edited menu item", req.body?.name]],
    ["PATCH", /^\/api\/admin\/menu\/products\/(.+)\/availability$/, (m, req) => ["Menu", req.body?.available ? "Marked item available" : "Marked item unavailable", productName(decodeURIComponent(m[1]))]],
    ["PATCH", /^\/api\/admin\/menu\/products\/(.+)\/archive$/, (m, req) => ["Menu", req.body?.archived ? "Archived menu item" : "Restored menu item", productName(decodeURIComponent(m[1]))]],
    ["POST", /^\/api\/admin\/users$/, (m, req) => ["Users", "Created account", `${req.body?.email} (${req.body?.role})`]],
    ["PATCH", /^\/api\/admin\/users\/(\d+)$/, (m, req) => ["Users", req.body?.status === "Inactive" ? "Archived account" : "Changed account access", `${person(m[1])}: ${req.body?.role} / ${req.body?.status}`]],
    ["POST", /^\/api\/admin\/users\/(\d+)\/recovery-code$/, m => ["Users", "Issued recovery code", person(m[1])]],
    ["POST", /^\/api\/admin\/users\/(\d+)\/temporary-password$/, m => ["Users", "Sent temporary password", person(m[1])]],
    ["POST", /^\/api\/admin\/vouchers$/, (m, req) => ["Vouchers", "Added voucher", String(req.body?.code || "").toUpperCase()]],
    ["PUT", /^\/api\/admin\/vouchers\/(.+)$/, m => ["Vouchers", "Edited voucher", decodeURIComponent(m[1])]],
    ["DELETE", /^\/api\/admin\/vouchers\/(.+)$/, m => ["Vouchers", "Removed voucher", decodeURIComponent(m[1])]]
  ];
  return (req, responseBody) => {
    const path = req.originalUrl.split("?")[0];
    for (const [method, pattern, describe] of rules) {
      if (method && method !== req.method) continue;
      const match = pattern.exec(path);
      if (match) return describe(match, req, responseBody);
    }
    return null;
  };
}

// Watches each change and records it after it succeeded.
function activityMiddleware(db) {
  const describe = describer(db);
  return (req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    let responseBody = null;
    const json = res.json.bind(res);
    res.json = body => { responseBody = body; return json(body); };
    res.on("finish", () => {
      if (res.statusCode >= 400) return;
      // Logging in has no signed-in user yet; the answer says who it was.
      const user = req.user || responseBody?.user;
      if (!user?.id) return;
      try {
        const entry = describe(req, responseBody);
        if (entry) record(db, user, entry[0], entry[1], entry[2] ?? "");
      } catch (error) {
        console.error("Activity could not be recorded:", error.code || error.name);
      }
    });
    next();
  };
}

function createActivityReader(db) {
  function list({q = "", role = "", area = "", from = "", to = "", page = 1} = {}) {
    const where = [], params = [];
    if (q) {
      where.push("(user_name LIKE ? OR action LIKE ? OR details LIKE ?)");
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (role) { where.push("role=?"); params.push(role); }
    if (area) { where.push("area=?"); params.push(area); }
    // Dates are Philippine dates; the log is stored in UTC (Manila is UTC+8).
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push("datetime(created_at,'+8 hours')>=?"); params.push(`${from} 00:00:00`); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push("datetime(created_at,'+8 hours')<=?"); params.push(`${to} 23:59:59`); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const size = 25;
    const total = db.prepare(`SELECT COUNT(*) AS n FROM activity_log ${clause}`).get(...params).n;
    const pages = Math.max(1, Math.ceil(total / size));
    const current = Math.min(pages, Math.max(1, Number.parseInt(page, 10) || 1));
    const rows = db.prepare(`SELECT id,user_name AS userName,role,area,action,details,created_at AS createdAt
      FROM activity_log ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, size, (current - 1) * size);
    const areas = db.prepare("SELECT DISTINCT area FROM activity_log ORDER BY area").all().map(row => row.area);
    return {rows, total, page: current, pages, areas};
  }
  return {list};
}

module.exports = {migrateActivityLog, record, activityMiddleware, createActivityReader};
