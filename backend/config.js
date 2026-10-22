const path=require("node:path");
const weak=value=>!value||/change.this|chooseyour|your.admin|example|replace.me|test.secret/i.test(value);
function checkConfig(env) {
  const issues=[];
  if (!env.JWT_SECRET || env.JWT_SECRET.length<32 || weak(env.JWT_SECRET)) issues.push("Set JWT_SECRET to a unique random secret of at least 32 characters.");
  if (!env.ADMIN_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.ADMIN_EMAIL)) issues.push("Set a valid ADMIN_EMAIL.");
  if (env.ADMIN_PASSWORD && (env.ADMIN_PASSWORD.length<12||weak(env.ADMIN_PASSWORD))) issues.push("Replace the placeholder administrator password and change the existing account password in the website.");
  try {
    const url=new URL(env.APP_ORIGIN||"");
    if (url.protocol!=="https:" || url.origin!==env.APP_ORIGIN) issues.push("APP_ORIGIN must be your exact HTTPS origin, without a path or trailing slash.");
  }catch {issues.push("Set APP_ORIGIN to your HTTPS website origin before production.");}
  return issues;
}
// Behind a hosting proxy (for example Render) the visitor's address comes from
// X-Forwarded-For. "loopback" = a proxy on this machine, a number = how many
// proxies to trust, "true" = trust the forwarded address (hosted platforms).
function trustProxy(value) {
  if (value==="loopback") return "loopback";
  if (value==="true") return true;
  if (/^[1-9]$/.test(value||"")) return Number(value);
  return false;
}
function config(env=process.env) {
  const production=env.NODE_ENV==="production";
  const port=Number(env.PORT||3000);
  if (!Number.isInteger(port)||port<1||port>65535) throw new Error("PORT must be between 1 and 65535.");
  if (!env.JWT_SECRET) throw new Error("Set JWT_SECRET before starting the backend.");
  const problems=checkConfig(env);
  if (production&&problems.length) throw new Error("Production configuration blocked: "+problems.join(" "));
  return {production,port,host:env.HOST||"127.0.0.1",origin:env.APP_ORIGIN||"http://localhost:"+port,
    trustProxy:trustProxy(env.TRUST_PROXY),
    databasePath:env.DATABASE_PATH?path.resolve(env.DATABASE_PATH):path.join(__dirname,"data","kopi.db")};
}
module.exports={config,checkConfig};
