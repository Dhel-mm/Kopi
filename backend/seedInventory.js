// The versioned CSV import runs once in database.js. Re-running this command
// must never restore old package sizes, fresh-milk recipes, or consumed stock.
const db = require("./database");
const count = db.prepare("SELECT COUNT(*) AS count FROM inventory_items WHERE is_archived=0").get().count;
console.log(`${count} active inventory products ready. Counts are preserved after the first CSV import.`);
db.close();
