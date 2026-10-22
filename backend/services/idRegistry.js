const {OrderError, formatIdNumber, PSGC_REGIONS} = require("./pricing");

// ---- Simulated government ID registry (capstone demonstration) -------------
// The shop cannot connect to the real OSCA (Senior Citizens) or NCDA/PDAO (PWD)
// databases, so this table stands in for them. The in-store POS checks each
// Senior Citizen / PWD ID here the way a real registry API would be asked
// (online orders use an uploaded ID photo that staff verify instead):
//   1. the ID number must follow the official format (see pricing.js);
//   2. the ID must exist in the registry and be the same type (Senior / PWD);
//   3. its status must be Active (not Revoked) and it must not be expired;
//   4. the name entered must match the name on the ID record;
//   5. a Senior Citizen must be 60 years old or older (from the birth date).
// save() and setStatus() maintain records (database tools and tests only).
// Records marked "demo" are sample data for the defense, not real people.
const DEMO_RECORDS = [
  ["04-3405-012-0001234", "PWD", "Maria Santos", "1998-11-23", "PDAO Calamba City, Laguna", "2029-06-30", "Active"],
  ["04-3405-031-00567", "PWD", "Carlo Mendoza", "1985-04-02", "PDAO Calamba City, Laguna", "2025-12-31", "Active"],
  ["13-7404-000-0004321", "PWD", "Ana Reyes", "2001-07-19", "PDAO Quezon City", "2028-01-31", "Revoked"],
  ["OSCA-CAL-2016-00123", "Senior Citizen", "Juan Dela Cruz", "1955-08-15", "OSCA Calamba City, Laguna", null, "Active"],
  ["OSCA-CAL-2019-00888", "Senior Citizen", "Remedios Santos", "1950-03-02", "OSCA Calamba City, Laguna", null, "Active"],
  ["OSCA-CAL-2021-00999", "Senior Citizen", "Pedro Ramos", "1961-02-10", "OSCA Calamba City, Laguna", null, "Revoked"],
  ["OSCA-CAL-2026-00456", "Senior Citizen", "Rosa Lim", "1968-05-01", "OSCA Calamba City, Laguna", null, "Active"]
];
const SENIOR_AGE = 60;

function migrateIdRegistry(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS discount_id_registry (
    id_number TEXT PRIMARY KEY,
    id_type TEXT NOT NULL CHECK(id_type IN ('Senior Citizen','PWD')),
    full_name TEXT NOT NULL,
    birth_date TEXT NOT NULL,
    issued_by TEXT NOT NULL,
    valid_until TEXT,
    status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Revoked')),
    is_demo INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const insert = db.prepare(`INSERT OR IGNORE INTO discount_id_registry
    (id_number,id_type,full_name,birth_date,issued_by,valid_until,status,is_demo) VALUES(?,?,?,?,?,?,?,1)`);
  for (const record of DEMO_RECORDS) insert.run(...record);
}

const manilaToday = (now = new Date()) => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
function ageOn(birthDate, today) {
  const [by, bm, bd] = birthDate.split("-").map(Number), [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}
const nameKey = value => String(value).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
// Same first and last name; a middle name or initial may be left out.
function sameName(entered, recorded) {
  const a = nameKey(entered), b = nameKey(recorded);
  return a.length >= 2 && b.length >= 2 && a[0] === b[0] && a[a.length - 1] === b[b.length - 1];
}
function dateInput(value, label, optional = false) {
  if (optional && (value == null || value === "")) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value) {
    throw new OrderError(`Enter a valid ${label} (YYYY-MM-DD).`);
  }
  return value;
}
function describe(row, today) {
  const expired = Boolean(row.valid_until && row.valid_until < today);
  return {idNumber: row.id_number, type: row.id_type, name: row.full_name, birthDate: row.birth_date,
    age: ageOn(row.birth_date, today), issuedBy: row.issued_by, validUntil: row.valid_until,
    status: row.status === "Revoked" ? "Revoked" : expired ? "Expired" : "Active", demo: Boolean(row.is_demo),
    region: row.id_type === "PWD" ? PSGC_REGIONS[row.id_number.slice(0, 2)] || null : null};
}

function createIdRegistry(db, clock = () => new Date()) {
  migrateIdRegistry(db);
  const find = db.prepare("SELECT * FROM discount_id_registry WHERE id_number=?");

  // The "registry API": returns the verified record or explains why it is denied.
  function verify({type, idNumber, name}) {
    const formatted = formatIdNumber(type, idNumber);
    const today = manilaToday(clock());
    const row = find.get(formatted);
    const office = type === "PWD" ? "the city PDAO / NCDA" : "the city OSCA";
    if (!row) throw new OrderError(`ID ${formatted} was not found in the ${type} registry. Please check the number, or ask the cardholder to confirm their registration with ${office}.`);
    const record = describe(row, today);
    if (record.type !== type) throw new OrderError(`ID ${formatted} is registered as a ${record.type} ID, not a ${type} ID.`);
    if (record.status === "Revoked") throw new OrderError(`Transaction denied: ${type} ID ${formatted} is revoked/invalid.`);
    if (record.status === "Expired") throw new OrderError(`Transaction denied: ${type} ID ${formatted} expired on ${record.validUntil}. The cardholder needs to renew it.`);
    if (!sameName(name, record.name)) throw new OrderError("The name entered does not match the name on this ID record. Enter the cardholder's name exactly as printed on the ID.");
    if (type === "Senior Citizen" && record.age < SENIOR_AGE) {
      throw new OrderError(`Transaction denied: the ID holder is ${record.age} years old. The Senior Citizen discount is for ages ${SENIOR_AGE} and above.`);
    }
    return {idNumber: record.idNumber, name: record.name, type: record.type, age: record.age,
      issuedBy: record.issuedBy, validUntil: record.validUntil, status: "Active", region: record.region};
  }

  function list() {
    const today = manilaToday(clock());
    return db.prepare("SELECT * FROM discount_id_registry ORDER BY id_type,full_name").all().map(row => describe(row, today));
  }

  function save(input) {
    const type = input?.type;
    if (!["Senior Citizen", "PWD"].includes(type)) throw new OrderError("Choose Senior Citizen or PWD.");
    const idNumber = formatIdNumber(type, input.idNumber);
    const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
    if (nameKey(name).length < 2 || name.length > 120) throw new OrderError("Enter the cardholder's first and last name.");
    const birthDate = dateInput(input.birthDate, "birth date");
    const today = manilaToday(clock());
    if (birthDate > today) throw new OrderError("The birth date cannot be in the future.");
    const validUntil = dateInput(input.validUntil, "valid-until date", true);
    const issuedBy = typeof input.issuedBy === "string" && input.issuedBy.trim() ? input.issuedBy.trim().slice(0, 120)
      : (type === "PWD" ? "PDAO" : "OSCA");
    const status = input.status === "Revoked" ? "Revoked" : "Active";
    db.prepare(`INSERT INTO discount_id_registry(id_number,id_type,full_name,birth_date,issued_by,valid_until,status,is_demo)
      VALUES(?,?,?,?,?,?,?,0) ON CONFLICT(id_number) DO UPDATE SET id_type=excluded.id_type,full_name=excluded.full_name,
      birth_date=excluded.birth_date,issued_by=excluded.issued_by,valid_until=excluded.valid_until,status=excluded.status,
      updated_at=CURRENT_TIMESTAMP`).run(idNumber, type, name, birthDate, issuedBy, validUntil, status);
    return describe(find.get(idNumber), today);
  }

  function setStatus(idNumber, status) {
    if (!["Active", "Revoked"].includes(status)) throw new OrderError("Choose Active or Revoked.");
    const changed = db.prepare("UPDATE discount_id_registry SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id_number=?").run(status, idNumber);
    if (!changed.changes) throw new OrderError("ID record was not found.", 404);
    return describe(find.get(idNumber), manilaToday(clock()));
  }

  return {verify, list, save, setStatus};
}

module.exports = {createIdRegistry, migrateIdRegistry, ageOn, sameName, SENIOR_AGE, DEMO_RECORDS};
