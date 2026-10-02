const express=require("express");
const bcrypt=require("bcryptjs");
const crypto=require("node:crypto");
const {authFor}=require("../middleware/auth");
const {rateLimit}=require("../middleware/rateLimit");
const accounts=require("../services/accounts");
const {OrderError}=require("../services/pricing");
const {sendError}=require("../services/orderWorkflow");

module.exports=function authRouter(db) {
  const router=express.Router();
  router.use(["/login","/signup","/reset-password"],rateLimit(db,"auth",40,15));
  router.post("/signup",async(req,res)=>{
    try {
      const b=req.body||{};
      const first=accounts.field(b.firstName,"first name");
      const last=accounts.field(b.lastName,"last name");
      const middle=accounts.field(b.middleName,"middle name",100,true)||null;
      const email=accounts.email(b.email);
      const password=accounts.password(b.password);
      const phone=b.phone?accounts.phone(b.phone):null;
      const hash=await bcrypt.hash(password,12);
      const id=db.transaction(()=>{
        if (db.prepare("SELECT id FROM users WHERE email=?").get(email)) throw new OrderError("An account with that email already exists.",409);
        return db.prepare("INSERT INTO users(first_name,last_name,middle_name,email,password_hash,phone,role) VALUES(?,?,?,?,?,?,'Customer')")
          .run(first,last,middle,email,hash,phone).lastInsertRowid;
      }).immediate();
      res.status(201).json({message:"Account created successfully.",...accounts.session(db.prepare("SELECT * FROM users WHERE id=?").get(id))});
    } catch(error) {sendError(res,error);}
  });
  router.post("/login",async(req,res)=>{
    try {
      const address=accounts.email(req.body?.email);
      const password=req.body?.password;
      if (typeof password!=="string" || Buffer.byteLength(password)>72) throw new OrderError("Incorrect email or password.",401);
      const user=db.prepare("SELECT * FROM users WHERE email=?").get(address);
      // A fixed valid hash keeps unknown-account attempts on the same bcrypt path.
      const hash=user?.password_hash||"$2b$12$QCeUvhtCDaILFKYBI.wuTe4STABLQhXvzlcAU/xhpxLbZGJUAdZrW";
      const matches=await bcrypt.compare(password,hash);
      if (!user || !matches || user.status!=="Active") throw new OrderError("Incorrect email or password, or account inactive.",401);
      const fresh=db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
      if (fresh.auth_version!==user.auth_version || fresh.status!=="Active") throw new OrderError("Account changed. Please sign in again.",401);
      res.json({message:"Login successful.",...accounts.session(fresh,req.body.remember===true)});
    } catch(error) {sendError(res,error);}
  });
  router.post("/logout",authFor(db),(req,res)=>{
    db.prepare("UPDATE users SET auth_version=auth_version+1,last_seen_at=NULL WHERE id=?").run(req.user.id);
    accounts.audit(db,req.user.id,req.user.id,"Signed out all sessions");
    res.json({message:"Signed out on all devices."});
  });
  router.post("/reset-password",async(req,res)=>{
    try {
      const code=accounts.field(req.body?.code,"recovery code",100);
      const password=accounts.password(req.body?.newPassword);
      const tokenHash=crypto.createHash("sha256").update(code).digest("hex");
      const record=db.prepare("SELECT * FROM password_resets WHERE token_hash=?").get(tokenHash);
      if (!record || record.used_at || record.expires_at<Date.now()) throw new OrderError("Recovery code is invalid or expired.");
      const hash=await bcrypt.hash(password,12);
      db.transaction(()=>{
        const fresh=db.prepare("SELECT * FROM password_resets WHERE token_hash=?").get(tokenHash);
        const user=db.prepare("SELECT * FROM users WHERE id=?").get(record.user_id);
        if (!fresh || fresh.used_at || fresh.expires_at<Date.now() || user.status!=="Active") throw new OrderError("Recovery code is invalid or expired.");
        db.prepare("UPDATE users SET password_hash=?,auth_version=auth_version+1,last_seen_at=NULL WHERE id=?").run(hash,user.id);
        db.prepare("UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL").run(Date.now(),user.id);
        accounts.audit(db,user.id,user.id,"Password recovered");
      }).immediate();
      res.json({message:"Password changed. Sign in with your new password."});
    } catch(error) {sendError(res,error);}
  });
  return router;
};
