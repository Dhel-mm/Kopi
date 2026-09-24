const fs=require("node:fs");
const path=require("node:path");
const Database=require("better-sqlite3");
function verifyDatabase(filename) {
  const db=new Database(path.resolve(filename),{readonly:true,fileMustExist:true});
  try {
    const integrity=db.pragma("integrity_check",{simple:true});
    const foreignKeys=db.pragma("foreign_key_check");
    if(integrity!=="ok"||foreignKeys.length)throw new Error("Database integrity check failed.");
    for(const table of ["users","orders","order_items","inventory_items"]) {
      if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))throw new Error("Missing required database table: "+table);
    }
    return {integrity,orders:db.prepare("SELECT COUNT(*) AS n FROM orders").get().n,users:db.prepare("SELECT COUNT(*) AS n FROM users").get().n};
  }finally{db.close();}
}
async function copyDatabase(source,destination) {
  const from=path.resolve(source),to=path.resolve(destination);
  if(from===to||fs.existsSync(to))throw new Error("Destination must be a new file; existing databases are never overwritten.");
  verifyDatabase(from);
  fs.mkdirSync(path.dirname(to),{recursive:true});
  const db=new Database(from,{readonly:true,fileMustExist:true});
  try {await db.backup(to);}finally{db.close();}
  return {path:to,...verifyDatabase(to)};
}
module.exports={verifyDatabase,copyDatabase};
