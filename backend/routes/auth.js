const express=require("express");
const bcrypt=require("bcryptjs");
const crypto=require("node:crypto");
const {authFor}=require("../middleware/auth");
const {rateLimit}=require("../middleware/rateLimit");
const accounts=require("../services/accounts");
const {OrderError}=require("../services/pricing");
const {sendError}=require("../services/orderWorkflow");
const {createMailer}=require("../services/mailer");
const {createEmailVerification}=require("../services/emailVerification");

// settings.mailer: email sender (tests pass a fake one).
// Email verification is on when email can be sent: always in local development
// (the code is printed in the server terminal), and in production once
// BREVO_API_KEY and MAIL_FROM are set.
module.exports=function authRouter(db,settings={}) {
  const router=express.Router();
  const mailer=settings.mailer||createMailer(process.env);
  const verificationOn=settings.emailVerification??(mailer.configured||!settings.production);
  const verification=createEmailVerification(db,mailer);
  const pendingUser=address=>{
    const user=db.prepare("SELECT * FROM users WHERE email=?").get(address);
    return user&&verification.isPending(user.id)?user:null;
  };
  // Sends a code but never fails the request when the email service is down:
  // the customer can press "Resend code" on the verification page.
  async function trySend(user) {
    try {return {...await verification.sendCode(user),failed:false};}
    catch(error) {return {sent:false,failed:true,message:error.message};}
  }
  const verifyBody=(user,result)=>({verificationRequired:true,email:user.email,maskedEmail:verification.maskEmail(user.email),
    codeSent:Boolean(result?.sent),waitSeconds:result?.waitSeconds||0,sendProblem:result?.failed?result.message:undefined});
  router.use(["/login","/signup","/reset-password"],rateLimit(db,"auth",40,15));
  router.use("/forgot-password",rateLimit(db,"forgot",10,15));
  router.use(["/verify-email","/resend-verification"],rateLimit(db,"verify",30,15));
  router.post("/signup",async(req,res)=>{
    try {
      const b=req.body||{};
      const first=accounts.personName(b.firstName,"first name");
      const last=accounts.personName(b.lastName,"last name");
      const middle=accounts.personName(b.middleName,"middle name",true)||null;
      const email=accounts.email(b.email);
      const password=accounts.password(b.password);
      const phone=b.phone?accounts.phone(b.phone):null;
      const hash=await bcrypt.hash(password,12);
      const id=db.transaction(()=>{
        const existing=db.prepare("SELECT id FROM users WHERE email=?").get(email);
        // An account that was never verified can be signed up again: only the
        // owner of the email can finish it, so nobody can hold an address hostage.
        if (existing&&verificationOn&&verification.isPending(existing.id)) {
          db.prepare("UPDATE users SET first_name=?,last_name=?,middle_name=?,password_hash=?,phone=?,auth_version=auth_version+1 WHERE id=?")
            .run(first,last,middle,hash,phone,existing.id);
          return existing.id;
        }
        if (existing) throw new OrderError("An account with that email already exists.",409);
        const newId=db.prepare("INSERT INTO users(first_name,last_name,middle_name,email,password_hash,phone,role) VALUES(?,?,?,?,?,?,'Customer')")
          .run(first,last,middle,email,hash,phone).lastInsertRowid;
        if (verificationOn) verification.markPending(newId);
        else db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(),newId);
        return newId;
      }).immediate();
      const user=db.prepare("SELECT * FROM users WHERE id=?").get(id);
      if (!verificationOn) return res.status(201).json({message:"Account created successfully.",...accounts.session(user)});
      const result=await trySend(user);
      res.status(201).json({message:"Account created. Enter the 6-digit code we sent to your email.",...verifyBody(user,result)});
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
      if (fresh.must_change_password && fresh.temp_password_expires_at && fresh.temp_password_expires_at<Date.now()) {
        throw new OrderError("Your temporary password has expired. Ask the shop owner to send a new one.",401);
      }
      if (verificationOn&&verification.isPending(fresh.id)) {
        const result=await trySend(fresh); // respects the 60-second wait between emails
        return res.status(403).json({message:"Please verify your email first. Enter the 6-digit code we sent to "+verification.maskEmail(fresh.email)+".",...verifyBody(fresh,result)});
      }
      res.json({message:"Login successful.",...accounts.session(fresh,req.body.remember===true)});
    } catch(error) {sendError(res,error);}
  });
  // Checks the 6-digit code. A correct code verifies the email and signs the customer in.
  router.post("/verify-email",async(req,res)=>{
    try {
      const address=accounts.email(req.body?.email);
      const user=pendingUser(address);
      if (!user) {
        const known=db.prepare("SELECT * FROM users WHERE email=?").get(address);
        if (known) return res.json({message:"Your email is already verified. You can log in.",alreadyVerified:true});
        throw new OrderError("Enter the 6-digit code from your email.",400);
      }
      verification.verify(user,req.body?.code);
      const fresh=db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
      if (fresh.status!=="Active") throw new OrderError("This account is inactive. Please contact the shop.",403);
      accounts.audit(db,fresh.id,fresh.id,"Signed in after email verification");
      res.json({message:"Email verified. Welcome to Kopi; Calamba!",...accounts.session(fresh)});
    } catch(error) {sendError(res,error);}
  });
  // Sends a new code. The answer does not say whether the email has an account.
  router.post("/resend-verification",async(req,res)=>{
    try {
      const address=accounts.email(req.body?.email);
      const user=verificationOn?pendingUser(address):null;
      if (!user) return res.json({message:"If that email is waiting for verification, a new code is on its way.",waitSeconds:60});
      const result=await verification.sendCode(user);
      if (!result.sent) return res.status(429).json({message:`Please wait ${result.waitSeconds} seconds before requesting another code.`,waitSeconds:result.waitSeconds});
      res.json({message:"A new code was sent to "+verification.maskEmail(user.email)+".",waitSeconds:result.waitSeconds});
    } catch(error) {sendError(res,error);}
  });
  router.post("/logout",authFor(db),(req,res)=>{
    db.prepare("UPDATE users SET auth_version=auth_version+1,last_seen_at=NULL WHERE id=?").run(req.user.id);
    accounts.audit(db,req.user.id,req.user.id,"Signed out all sessions");
    res.json({message:"Signed out on all devices."});
  });
  // Forgot password: emails a single-use recovery code to the account's own email.
  // The email must belong to an account (the shop asked for this check), so the
  // answer says when no account uses it.
  // The emailed code is only 6 digits, so it works only together with the email it
  // was sent to, allows 5 wrong tries, and is stored as a keyed hash.
  const RECOVERY_MINUTES=15,RECOVERY_WAIT_SECONDS=60,RECOVERY_ATTEMPTS=5;
  const emailedCodeHash=(userId,code)=>crypto.createHmac("sha256",process.env.JWT_SECRET||"kopi-recovery")
    .update("recovery:"+userId+":"+code).digest("hex");
  const sameHash=(a,b)=>{
    const left=Buffer.from(String(a),"hex"),right=Buffer.from(String(b),"hex");
    return left.length===right.length&&left.length>0&&crypto.timingSafeEqual(left,right);
  };
  router.post("/forgot-password",async(req,res)=>{
    try {
      const address=accounts.email(req.body?.email);
      const user=db.prepare("SELECT * FROM users WHERE email=?").get(address);
      if (!user) throw new OrderError("No account uses this email. Check the spelling, or sign up first.",404);
      if (user.status!=="Active") throw new OrderError("This account is inactive. Please contact the shop.",403);
      if (verificationOn&&verification.isPending(user.id)) {
        throw new OrderError("This email is not verified yet. Log in to get a new verification code, then verify your email first.",409);
      }
      // Emailed codes have no issuer. Wait a minute between emails.
      const last=db.prepare("SELECT MAX(expires_at) AS expires FROM password_resets WHERE user_id=? AND issued_by IS NULL AND used_at IS NULL").get(user.id).expires;
      const wait=last?Math.ceil((last-RECOVERY_MINUTES*60000+RECOVERY_WAIT_SECONDS*1000-Date.now())/1000):0;
      if (wait>0) return res.status(429).json({message:`Please wait ${wait} seconds before requesting another code.`,waitSeconds:wait});
      const code=String(crypto.randomInt(0,1000000)).padStart(6,"0");
      const tokenHash=emailedCodeHash(user.id,code);
      db.transaction(()=>{
        db.prepare("DELETE FROM password_resets WHERE user_id=? OR expires_at<?").run(user.id,Date.now());
        db.prepare("INSERT INTO password_resets(token_hash,user_id,expires_at,issued_by) VALUES(?,?,?,NULL)")
          .run(tokenHash,user.id,Date.now()+RECOVERY_MINUTES*60000);
        accounts.audit(db,user.id,user.id,"Recovery code emailed");
      }).immediate();
      const shown=code;
      let delivery;
      try {
        delivery=await mailer.send({to:user.email,subject:"Your Kopi; Calamba recovery code",
          text:`Hi ${user.first_name},\n\nYour Kopi; Calamba recovery code is: ${shown}\n\nEnter it on the "Recover your account" page with your new password. It works once and expires in ${RECOVERY_MINUTES} minutes.\n\nIf you did not ask to reset your password, you can ignore this email. Your password stays the same.\n\nKopi; Calamba`,
          html:`<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#30291f">
            <h2 style="margin:0 0 12px">Recover your account</h2><p>Hi ${String(user.first_name).replace(/[&<>"']/g,"")},</p>
            <p>Your Kopi; Calamba recovery code is:</p>
            <p style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f4e7cf;border-radius:12px;padding:14px;text-align:center;margin:16px 0">${shown}</p>
            <p>Enter it on the "Recover your account" page with your new password. It works once and expires in ${RECOVERY_MINUTES} minutes.</p>
            <p style="color:#777;font-size:13px">If you did not ask to reset your password, you can ignore this email. Your password stays the same.</p></div>`});
      } catch(error) {
        db.prepare("DELETE FROM password_resets WHERE token_hash=?").run(tokenHash);
        throw error;
      }
      res.json({message:delivery?.delivered===false
        ?"Email is not set up on this computer, so the recovery code was printed in the server window."
        :"A recovery code was sent to "+verification.maskEmail(user.email)+". Check your inbox and spam folder.",
        maskedEmail:verification.maskEmail(user.email),waitSeconds:RECOVERY_WAIT_SECONDS});
    } catch(error) {sendError(res,error);}
  });
  router.post("/reset-password",async(req,res)=>{
    try {
      const code=accounts.field(typeof req.body?.code==="string"?req.body.code.replace(/\s+/g,""):req.body?.code,"recovery code",100);
      const password=accounts.password(req.body?.newPassword);
      let tokenHash;
      if (/^\d{6}$/.test(code)) {
        // A 6-digit code from the email: it must match the account of that email.
        if (typeof req.body?.email!=="string"||!req.body.email.trim()) throw new OrderError("Enter the email of your account (the one the code was sent to).");
        const owner=db.prepare("SELECT id FROM users WHERE email=?").get(accounts.email(req.body.email));
        const sent=owner&&db.prepare(`SELECT * FROM password_resets WHERE user_id=? AND issued_by IS NULL AND used_at IS NULL
          AND expires_at>=? ORDER BY expires_at DESC LIMIT 1`).get(owner.id,Date.now());
        if (!sent) throw new OrderError("Recovery code is invalid or expired. Send a new code to your email.");
        if (sent.attempts>=RECOVERY_ATTEMPTS) throw new OrderError("Too many wrong codes. Send a new code to your email.",429);
        if (!sameHash(sent.token_hash,emailedCodeHash(owner.id,code))) {
          db.prepare("UPDATE password_resets SET attempts=attempts+1 WHERE token_hash=?").run(sent.token_hash);
          const left=RECOVERY_ATTEMPTS-sent.attempts-1;
          throw new OrderError(left>0?`That code is incorrect. ${left} ${left===1?"try":"tries"} left.`:"Too many wrong codes. Send a new code to your email.",400);
        }
        tokenHash=sent.token_hash;
      } else {
        // A longer code given by the shop (Users > Recovery code, or the server tool).
        tokenHash=crypto.createHash("sha256").update(code).digest("hex");
      }
      const record=db.prepare("SELECT * FROM password_resets WHERE token_hash=?").get(tokenHash);
      if (!record || record.used_at || record.expires_at<Date.now() || (record.issued_by==null&&!/^\d{6}$/.test(code))) {
        throw new OrderError("Recovery code is invalid or expired.");
      }
      const hash=await bcrypt.hash(password,12);
      db.transaction(()=>{
        const fresh=db.prepare("SELECT * FROM password_resets WHERE token_hash=?").get(tokenHash);
        const user=db.prepare("SELECT * FROM users WHERE id=?").get(record.user_id);
        if (!fresh || fresh.used_at || fresh.expires_at<Date.now() || user.status!=="Active") throw new OrderError("Recovery code is invalid or expired.");
        db.prepare("UPDATE users SET password_hash=?,must_change_password=0,temp_password_expires_at=NULL,auth_version=auth_version+1,last_seen_at=NULL WHERE id=?").run(hash,user.id);
        db.prepare("UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL").run(Date.now(),user.id);
        accounts.audit(db,user.id,user.id,"Password recovered");
      }).immediate();
      res.json({message:"Password changed. Sign in with your new password."});
    } catch(error) {sendError(res,error);}
  });
  return router;
};
