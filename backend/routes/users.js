const express=require("express");
const bcrypt=require("bcryptjs");
const crypto=require("node:crypto");
const {authFor,requireRole}=require("../middleware/auth");
const {rateLimit}=require("../middleware/rateLimit");
const accounts=require("../services/accounts");
const {OrderError}=require("../services/pricing");
const {sendError}=require("../services/orderWorkflow");

module.exports=function usersRouter(db) {
  const router=express.Router();
  router.use(authFor(db),requireRole("Admin"));
  router.get("/",(req,res)=>{
    const users=db.prepare(`SELECT id,first_name AS firstName,last_name AS lastName,
      first_name||' '||last_name AS name,email,phone,role,status,created_at AS createdAt,
      (SELECT COUNT(*) FROM orders WHERE user_id=users.id AND order_type='Online') AS totalOrders,
      (SELECT COALESCE(SUM(total),0) FROM orders WHERE user_id=users.id AND order_type='Online' AND status='Completed') AS totalSpent
      FROM users ORDER BY id DESC`).all();
    res.json({users});
  });
  router.use(rateLimit(db,"admin-accounts",30,15));
  router.post("/",async(req,res)=>{
    try {
      const b=req.body||{};
      const actor=await accounts.verifyPassword(db,req.user.id,b.currentPassword);
      const first=accounts.field(b.firstName,"first name"),last=accounts.field(b.lastName,"last name");
      const email=accounts.email(b.email),password=accounts.password(b.password);
      const phone=b.phone?accounts.phone(b.phone):null;
      if (!["Admin","Customer"].includes(b.role)) throw new OrderError("Choose Customer or Admin.");
      const hash=await bcrypt.hash(password,12);
      const id=db.transaction(()=>{
        accounts.assertAdmin(db,actor);
        if (db.prepare("SELECT id FROM users WHERE email=?").get(email)) throw new OrderError("That email is already used.",409);
        const id=db.prepare("INSERT INTO users(first_name,last_name,email,password_hash,phone,role) VALUES(?,?,?,?,?,?)")
          .run(first,last,email,hash,phone,b.role).lastInsertRowid;
        accounts.audit(db,req.user.id,id,"Account created: "+b.role);
        return id;
      }).immediate();
      res.status(201).json({id,message:"Account created."});
    }catch(error){sendError(res,error);}
  });
  router.patch("/:id",async(req,res)=>{
    try {
      const b=req.body||{};
      const actor=await accounts.verifyPassword(db,req.user.id,b.currentPassword);
      if (!["Admin","Customer"].includes(b.role)||!["Active","Inactive"].includes(b.status)) throw new OrderError("Choose a valid role and account status.");
      db.transaction(()=>{
        accounts.assertAdmin(db,actor);
        const user=db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
        if (!user) throw new OrderError("Account not found.",404);
        if (user.id===req.user.id && (b.role!=="Admin"||b.status!=="Active")) throw new OrderError("You cannot disable or demote your own administrator account.");
        const removingAdmin=user.role==="Admin"&&user.status==="Active"&&(b.role!=="Admin"||b.status!=="Active");
        if (removingAdmin && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='Admin' AND status='Active'").get().n<=1) throw new OrderError("Keep at least one active administrator.");
        db.prepare("UPDATE users SET role=?,status=?,auth_version=auth_version+1 WHERE id=?").run(b.role,b.status,user.id);
        accounts.audit(db,req.user.id,user.id,"Access changed: "+b.role+" / "+b.status);
      }).immediate();
      res.json({message:"Account access updated. Previous sessions were revoked."});
    }catch(error){sendError(res,error);}
  });
  router.post("/:id/recovery-code",async(req,res)=>{
    try {
      const actor=await accounts.verifyPassword(db,req.user.id,req.body?.currentPassword);
      if (req.body?.identityConfirmed!==true) throw new OrderError("Verify the account owner's identity before issuing a recovery code.");
      const user=db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
      if (!user || user.status!=="Active") throw new OrderError("An active account is required.",404);
      const code=crypto.randomBytes(32).toString("base64url"),expiresAt=Date.now()+15*60000;
      db.transaction(()=>{
        accounts.assertAdmin(db,actor);
        db.prepare("DELETE FROM password_resets WHERE user_id=? OR expires_at<?").run(user.id,Date.now());
        db.prepare("INSERT INTO password_resets(token_hash,user_id,expires_at,issued_by) VALUES(?,?,?,?)")
          .run(crypto.createHash("sha256").update(code).digest("hex"),user.id,expiresAt,req.user.id);
        accounts.audit(db,req.user.id,user.id,"Recovery code issued");
      }).immediate();
      res.json({code,expiresAt,message:"Single-use code, valid for 15 minutes. Share privately with the verified owner."});
    }catch(error){sendError(res,error);}
  });
  return router;
};
