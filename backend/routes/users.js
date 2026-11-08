const express=require("express");
const bcrypt=require("bcryptjs");
const crypto=require("node:crypto");
const {authFor,requireRole}=require("../middleware/auth");
const {rateLimit}=require("../middleware/rateLimit");
const accounts=require("../services/accounts");
const {OrderError}=require("../services/pricing");
const {sendError}=require("../services/orderWorkflow");
const {createMailer}=require("../services/mailer");

module.exports=function usersRouter(db,settings={}) {
  const router=express.Router();
  const mailer=settings.mailer||createMailer(process.env);
  const temporaryExpiry=()=>Date.now()+accounts.TEMPORARY_PASSWORD_HOURS*3600000;
  // The password is only returned when the email could not be delivered, so the
  // administrator can hand it over privately. It is never saved in plain text.
  async function deliverTemporary(user,temporary) {
    const emailSent=await accounts.sendTemporaryPassword(mailer,user,temporary);
    return emailSent
      ? {emailSent,message:"A temporary password was emailed to "+user.email+"."}
      : {emailSent,temporaryPassword:temporary,message:"The email could not be sent. Give this temporary password to the employee privately. It is shown only once."};
  }
  router.use(authFor(db),requireRole("Admin"));
  router.get("/",(req,res)=>{
    const users=db.prepare(`SELECT id,first_name AS firstName,last_name AS lastName,
      first_name||' '||last_name AS name,email,phone,role,status,created_at AS createdAt,last_seen_at AS lastSeenAt,
      (SELECT COUNT(*) FROM orders WHERE user_id=users.id AND order_type='Online') AS totalOrders,
      (SELECT COALESCE(SUM(total),0) FROM orders WHERE user_id=users.id AND order_type='Online' AND status='Completed') AS totalSpent
      FROM users ORDER BY id DESC`).all();
    const cutoff=Date.now()-120000;
    res.json({users:users.map(user=>({...user,online:user.status==="Active" && user.lastSeenAt!=null && user.lastSeenAt>=cutoff}))});
  });
  router.use(rateLimit(db,"admin-accounts",30,15));
  router.post("/",async(req,res)=>{
    try {
      const b=req.body||{};
      const actor=await accounts.verifyPassword(db,req.user.id,b.currentPassword);
      const first=accounts.personName(b.firstName,"first name"),last=accounts.personName(b.lastName,"last name");
      const email=accounts.email(b.email);
      const phone=b.phone?accounts.phone(b.phone):null;
      // Customers create their own accounts with Sign up, so admins add employees only.
      if (!["Admin","Cashier","Staff"].includes(b.role)) throw new OrderError("Choose Cashier, Staff, or Admin. Customers sign up on the website.");
      const temporary=accounts.temporaryPassword();
      const hash=await bcrypt.hash(temporary,12);
      const id=db.transaction(()=>{
        accounts.assertAdmin(db,actor);
        if (db.prepare("SELECT id FROM users WHERE email=?").get(email)) throw new OrderError("That email is already used.",409);
        const id=db.prepare("INSERT INTO users(first_name,last_name,email,password_hash,phone,role,must_change_password,temp_password_expires_at) VALUES(?,?,?,?,?,?,1,?)")
          .run(first,last,email,hash,phone,b.role,temporaryExpiry()).lastInsertRowid;
        accounts.audit(db,req.user.id,id,"Account created: "+b.role);
        return id;
      }).immediate();
      const delivery=await deliverTemporary({email,first_name:first},temporary);
      res.status(201).json({id,...delivery,message:"Account created. "+delivery.message});
    }catch(error){sendError(res,error);}
  });
  // Sends a new temporary password when an employee forgets theirs.
  router.post("/:id/temporary-password",async(req,res)=>{
    try {
      const actor=await accounts.verifyPassword(db,req.user.id,req.body?.currentPassword);
      const user=db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
      if (!user || user.status!=="Active") throw new OrderError("An active account is required.",404);
      if (!["Cashier","Staff"].includes(user.role)) throw new OrderError("Temporary passwords are for Staff and Cashier accounts. Use a recovery code for this account.");
      const temporary=accounts.temporaryPassword();
      const hash=await bcrypt.hash(temporary,12);
      db.transaction(()=>{
        accounts.assertAdmin(db,actor);
        db.prepare(`UPDATE users SET password_hash=?,must_change_password=1,temp_password_expires_at=?,
          auth_version=auth_version+1,last_seen_at=NULL WHERE id=?`).run(hash,temporaryExpiry(),user.id);
        db.prepare("DELETE FROM password_resets WHERE user_id=?").run(user.id);
        accounts.audit(db,req.user.id,user.id,"Temporary password issued");
      }).immediate();
      res.json(await deliverTemporary(user,temporary));
    }catch(error){sendError(res,error);}
  });
  // Accounts are never deleted: setting one to Inactive archives it. Its orders and
  // history stay, it cannot sign in, and it can be restored at any time.
  router.patch("/:id",async(req,res)=>{
    try {
      const b=req.body||{};
      const actor=await accounts.verifyPassword(db,req.user.id,b.currentPassword);
      if (!["Admin","Customer","Cashier","Staff"].includes(b.role)||!["Active","Inactive"].includes(b.status)) throw new OrderError("Choose a valid role and account status.");
      db.transaction(()=>{
        accounts.assertAdmin(db,actor);
        const user=db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
        if (!user) throw new OrderError("Account not found.",404);
        if (user.id===req.user.id && (b.role!=="Admin"||b.status!=="Active")) throw new OrderError("You cannot disable or demote your own administrator account.");
        const removingAdmin=user.role==="Admin"&&user.status==="Active"&&(b.role!=="Admin"||b.status!=="Active");
        if (removingAdmin && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='Admin' AND status='Active'").get().n<=1) throw new OrderError("Keep at least one active administrator.");
        db.prepare("UPDATE users SET role=?,status=?,auth_version=auth_version+1,last_seen_at=NULL WHERE id=?").run(b.role,b.status,user.id);
        accounts.audit(db,req.user.id,user.id,"Access changed: "+b.role+" / "+b.status);
      }).immediate();
      res.json({message:b.status==="Inactive"?"Account archived. It can no longer sign in, and its records were kept.":"Account access updated. Previous sessions were revoked."});
    }catch(error){sendError(res,error);}
  });
  router.post("/:id/recovery-code",async(req,res)=>{
    try {
      const actor=await accounts.verifyPassword(db,req.user.id,req.body?.currentPassword);
      if (req.body?.identityConfirmed!==true) throw new OrderError("Verify the account owner's identity before issuing a recovery code.");
      const user=db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
      if (!user || user.status!=="Active") throw new OrderError("An active account is required.",404);
      const code=String(crypto.randomInt(100000000000,1000000000000)),expiresAt=Date.now()+15*60000;
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
