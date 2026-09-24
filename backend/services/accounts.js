const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
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
function password(value) {
  if (typeof value!=="string" || value.length<12 || Buffer.byteLength(value,"utf8")>72) {
    throw new OrderError("Use a password of at least 12 characters and no more than 72 UTF-8 bytes.");
  }
  return value;
}
function phone(value) {
  if (value===null || value==="") return null;
  const result=field(value,"phone number",11);
  if (!/^09\d{9}$/.test(result)) throw new OrderError("Use an 11-digit phone number beginning with 09.");
  return result;
}
function publicUser(row) {
  return {id:row.id,firstName:row.first_name,lastName:row.last_name,middleName:row.middle_name,
    email:row.email,phone:row.phone,role:row.role,status:row.status,createdAt:row.created_at,avatar:row.avatar_data||null};
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
    first:body.firstName===undefined?user.first_name:field(body.firstName,"first name"),
    last:body.lastName===undefined?user.last_name:field(body.lastName,"last name"),
    middle:body.middleName===undefined?user.middle_name:field(body.middleName,"middle name",100,true)||null,
    email:body.email===undefined?user.email:email(body.email),
    phone:body.phone===undefined?user.phone:phone(body.phone)
  };
  const changingPassword=body.newPassword!==undefined && body.newPassword!=="";
  if (changingPassword) password(body.newPassword);
  const sensitive=changingPassword || next.email!==user.email;
  if (sensitive) await verifyPassword(db,id,body.currentPassword);
  const hash=changingPassword?await bcrypt.hash(body.newPassword,12):user.password_hash;
  db.transaction(()=>{
    const fresh=db.prepare("SELECT * FROM users WHERE id=?").get(id);
    if (fresh.auth_version!==user.auth_version || fresh.status!=="Active") throw new OrderError("Your account changed. Sign in again.",401);
    if (db.prepare("SELECT id FROM users WHERE email=? AND id!=?").get(next.email,id)) throw new OrderError("That email is already used.",409);
    db.prepare(`UPDATE users SET first_name=?,last_name=?,middle_name=?,email=?,phone=?,password_hash=?,
      auth_version=auth_version+? WHERE id=?`).run(next.first,next.last,next.middle,next.email,next.phone,hash,sensitive?1:0,id);
    if (sensitive) {
      db.prepare("DELETE FROM password_resets WHERE user_id=?").run(id);
      audit(db,id,id,changingPassword?"Password changed":"Email changed");
    }
  }).immediate();
  return session(db.prepare("SELECT * FROM users WHERE id=?").get(id));
}
module.exports={field,email,password,phone,publicUser,session,verifyPassword,updateProfile,audit,assertAdmin};
