const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const {OrderError} = require("./pricing");

function field(value, name, max=100, optional=false, multiline=false) {
  if (optional && (value===null || value===undefined || (typeof value==="string" && !value.trim()))) return "";
  const controls=multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/;
  if (typeof value!=="string" || !value.trim() || value.trim().length>max || controls.test(value)) {
    throw new OrderError("Enter a valid "+name+" (up to "+max+" characters).");
  }
  return value.trim();
}
function email(value) {
  const address=field(value,"email address",254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new OrderError("Enter a valid email address.");
  return address;
}
// First, middle and last names may not contain numbers.
function personName(value, name, optional=false) {
  const result=field(value,name,100,optional);
  if (/\p{N}/u.test(result)) throw new OrderError("The "+name+" cannot contain numbers.");
  return result;
}
function password(value) {
  if (typeof value!=="string" || value.length<8 || Buffer.byteLength(value,"utf8")>72) {
    throw new OrderError("Use a password of at least 8 characters and no more than 72 UTF-8 bytes.");
  }
  return value;
}
// Staff and cashier passwords start as a temporary one sent by email. Letters
// and digits that are easy to confuse (0/O, 1/l/I) are left out.
const TEMPORARY_PASSWORD_HOURS=72;
function temporaryPassword() {
  const characters="ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({length:12},()=>characters[crypto.randomInt(characters.length)]).join("");
}
// Emails the temporary password. When email cannot be delivered the caller shows
// it once to the administrator, who hands it over privately.
async function sendTemporaryPassword(mailer,user,temporary) {
  try {
    const result=await mailer.send({
      to:user.email,
      subject:"Your Kopi; Calamba temporary password",
      text:`Hello ${user.first_name},\n\nYour temporary password is: ${temporary}\n\nLog in with your email and this password. You will be asked to create your own password right away. It expires in ${TEMPORARY_PASSWORD_HOURS} hours.\n\nIf you did not expect this email, please tell the shop owner.`
    });
    return Boolean(result?.delivered);
  } catch {
    return false;
  }
}
function phone(value) {
  if (value===null || value==="") return null;
  const result=field(value,"phone number",11);
  if (!/^09\d{9}$/.test(result)) throw new OrderError("Use an 11-digit phone number beginning with 09.");
  return result;
}
function publicUser(row) {
  return {id:row.id,firstName:row.first_name,lastName:row.last_name,middleName:row.middle_name,
    email:row.email,phone:row.phone,role:row.role,status:row.status,createdAt:row.created_at,avatar:row.avatar_data||null,
    mustChangePassword:Boolean(row.must_change_password)};
}
function session(user,remember=false) {
  return {user:publicUser(user),token:jwt.sign({id:user.id,ver:user.auth_version||0},process.env.JWT_SECRET,
    {algorithm:"HS256",expiresIn:remember?"7d":"12h"})};
}
async function verifyPassword(db,id,value) {
  const user=db.prepare("SELECT * FROM users WHERE id=?").get(id);
  if (typeof value!=="string" || Buffer.byteLength(value)>72 || !user ||
      !await bcrypt.compare(value,user.password_hash)) throw new OrderError("Your current password is incorrect.",400);
  return user;
}
function audit(db,actor,subject,action) {
  db.prepare("INSERT INTO account_audit(actor_id,subject_id,action) VALUES(?,?,?)").run(actor,subject,action);
}
function assertAdmin(db,actor) {
  const current=db.prepare("SELECT role,status,auth_version FROM users WHERE id=?").get(actor.id);
  if (!current || current.role!=="Admin" || current.status!=="Active" || current.auth_version!==actor.auth_version) {
    throw new OrderError("Your administrator session changed. Sign in again.",401);
  }
}
async function updateProfile(db,id,body) {
  const user=db.prepare("SELECT * FROM users WHERE id=?").get(id);
  if (!user) throw new OrderError("Account not found.",404);
  const next={
    // A name that is saved unchanged is not re-checked, so older accounts can still save.
    first:body.firstName===undefined||body.firstName===user.first_name?user.first_name:personName(body.firstName,"first name"),
    last:body.lastName===undefined||body.lastName===user.last_name?user.last_name:personName(body.lastName,"last name"),
    middle:body.middleName===undefined||body.middleName===user.middle_name?user.middle_name:personName(body.middleName,"middle name",true)||null,
    email:body.email===undefined?user.email:email(body.email),
    phone:body.phone===undefined?user.phone:phone(body.phone)
  };
  const changingPassword=body.newPassword!==undefined && body.newPassword!=="";
  if (changingPassword) password(body.newPassword);
  const sensitive=changingPassword || next.email!==user.email;
  if (sensitive) await verifyPassword(db,id,body.currentPassword);
  if (changingPassword && user.must_change_password && await bcrypt.compare(body.newPassword,user.password_hash)) {
    throw new OrderError("Choose a new password that is different from your temporary password.");
  }
  const hash=changingPassword?await bcrypt.hash(body.newPassword,12):user.password_hash;
  db.transaction(()=>{
    const fresh=db.prepare("SELECT * FROM users WHERE id=?").get(id);
    if (fresh.auth_version!==user.auth_version || fresh.status!=="Active") throw new OrderError("Your account changed. Sign in again.",401);
    if (db.prepare("SELECT id FROM users WHERE email=? AND id!=?").get(next.email,id)) throw new OrderError("That email is already used.",409);
    db.prepare(`UPDATE users SET first_name=?,last_name=?,middle_name=?,email=?,phone=?,password_hash=?,
      auth_version=auth_version+? WHERE id=?`).run(next.first,next.last,next.middle,next.email,next.phone,hash,sensitive?1:0,id);
    if (changingPassword) db.prepare("UPDATE users SET must_change_password=0,temp_password_expires_at=NULL WHERE id=?").run(id);
    if (sensitive) {
      db.prepare("DELETE FROM password_resets WHERE user_id=?").run(id);
      audit(db,id,id,changingPassword?"Password changed":"Email changed");
    }
  }).immediate();
  return session(db.prepare("SELECT * FROM users WHERE id=?").get(id));
}
module.exports={field,personName,email,password,phone,publicUser,session,verifyPassword,updateProfile,audit,assertAdmin,
  temporaryPassword,sendTemporaryPassword,TEMPORARY_PASSWORD_HOURS};
