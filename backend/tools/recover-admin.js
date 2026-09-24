const path=require("node:path");
const crypto=require("node:crypto");
require("dotenv").config({path:path.join(__dirname,"../.env"),quiet:true});
const Database=require("better-sqlite3");
const email=String(process.argv[2]||"").trim().toLowerCase();
if(!email) {
  console.error("Usage: npm.cmd run recover:admin -- admin@email.address");
  process.exitCode=1;
} else {
  const db=new Database(process.env.DATABASE_PATH||path.join(__dirname,"../data/kopi.db"),{fileMustExist:true});
  try {
    const user=db.prepare("SELECT id FROM users WHERE email=? AND role='Admin' AND status='Active'").get(email);
    if(!user)throw new Error("No active administrator matches that email.");
    const code=crypto.randomBytes(32).toString("base64url");
    db.transaction(()=>{
      db.prepare("DELETE FROM password_resets WHERE user_id=?").run(user.id);
      db.prepare("INSERT INTO password_resets(token_hash,user_id,expires_at,issued_by) VALUES(?,?,?,?)")
        .run(crypto.createHash("sha256").update(code).digest("hex"),user.id,Date.now()+15*60000,user.id);
      db.prepare("INSERT INTO account_audit(actor_id,subject_id,action) VALUES(?,?,'Recovery code issued by local server operator')").run(user.id,user.id);
    }).immediate();
    console.log("Open /reset.html on your website. Keep this single-use, 15-minute code private:\n"+code);
  }catch(error){console.error(error.message);process.exitCode=1;}
  finally{db.close();}
}
