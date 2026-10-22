const {test}=require("node:test");
const assert=require("node:assert/strict");
const {parseManualPayment,migrateManualPayments}=require("../services/manualPayment");
const Database=require("better-sqlite3");

test("manual reference validation never automatically verifies a payment",()=>{
  assert.deepEqual(parseManualPayment("GCash"," 0001234567890 "),{payment:"GCash",reference:"0001234567890",status:"Pending verification"});
  assert.deepEqual(parseManualPayment("Cash","1234567890"),{payment:"Cash",reference:null,status:"Unpaid"});
  for(const value of ["","123","abc",123456789,"1".repeat(31),"123456789012","12345678901234","12345678901AB","1234 5678 9012"]) assert.throws(()=>parseManualPayment("GCash",value));
  assert.throws(()=>parseManualPayment("Unknown",""));
});
test("payment migration is repeatable and preserves historic orders",()=>{
  const db=new Database(":memory:");
  try{
    db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE orders(id INTEGER PRIMARY KEY,payment TEXT,total REAL,status TEXT); INSERT INTO orders VALUES(1,'Cash',120,'Completed'),(2,'GCash',150,'New');");
    migrateManualPayments(db);migrateManualPayments(db);
    const rows=db.prepare("SELECT * FROM orders ORDER BY id").all();
    assert.equal(rows.length,2);assert.equal(rows[0].total,120);assert.equal(rows[0].status,"Completed");
    assert.equal(rows[1].payment_status,"Pending verification");
  }finally{db.close();}
});
