// Email verification for new customer accounts.
// After signing up, a customer must enter the 6-digit code sent to their email
// before they can log in. Accounts made before this feature, and accounts the
// administrator creates, are not affected: only accounts with a pending row in
// email_verifications are blocked.
const crypto = require("node:crypto");
const {OrderError} = require("./pricing");

const CODE_MINUTES = 10;          // a code expires after 10 minutes
const MAX_ATTEMPTS = 5;           // wrong guesses before the code must be resent
const RESEND_SECONDS = 60;        // wait between emails
const MAX_SENDS_PER_HOUR = 5;     // emails per account per hour
const MINUTE = 60000;

function migrateEmailVerification(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(users)").all().map(row => row.name));
  if (!columns.has("email_verified_at")) db.exec("ALTER TABLE users ADD COLUMN email_verified_at INTEGER");
  db.exec(`CREATE TABLE IF NOT EXISTS email_verifications (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER NOT NULL,
    window_start INTEGER NOT NULL,
    sends_in_window INTEGER NOT NULL DEFAULT 1
  )`);
}

// Codes are stored only as a keyed hash, so a copy of the database does not reveal them.
function hashCode(userId, code) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET || "kopi-email-verification")
    .update(userId + ":" + code).digest("hex");
}
function sameHash(a, b) {
  const left = Buffer.from(a, "hex"), right = Buffer.from(b, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function maskEmail(email) {
  const [name, domain] = email.split("@");
  return (name.length <= 2 ? name[0] + "*" : name.slice(0, 2) + "*".repeat(Math.min(6, name.length - 2))) + "@" + domain;
}
function message(firstName, code) {
  const text = `Hi ${firstName},\n\nYour Kopi; Calamba verification code is: ${code}\n\n` +
    `Enter this code on the website to finish creating your account. It expires in ${CODE_MINUTES} minutes.\n\n` +
    `If you did not create an account, you can ignore this email.\n\nKopi; Calamba\n72 Villanueva Subdivision, Camia Street, Brgy. Lingga, Calamba, Laguna`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#30291f">
    <h2 style="margin:0 0 12px">Verify your email</h2>
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>Your Kopi; Calamba verification code is:</p>
    <p style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f4e7cf;border-radius:12px;padding:14px;text-align:center;margin:16px 0">${code}</p>
    <p>Enter this code on the website to finish creating your account. It expires in ${CODE_MINUTES} minutes.</p>
    <p style="color:#777;font-size:13px">If you did not create an account, you can ignore this email.</p>
    <p style="color:#777;font-size:13px">Kopi; Calamba · 72 Villanueva Subdivision, Camia Street, Brgy. Lingga, Calamba, Laguna</p></div>`;
  return {subject: "Your Kopi; Calamba verification code: " + code, text, html};
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[ch]));
}

function createEmailVerification(db, mailer, now = () => Date.now()) {
  const pending = userId => db.prepare("SELECT * FROM email_verifications WHERE user_id=?").get(userId);

  // Creates a new code and emails it. Respects the resend wait and hourly limit.
  async function sendCode(user, {force = false} = {}) {
    const time = now();
    const current = pending(user.id);
    if (current && !force) {
      const wait = Math.ceil((current.sent_at + RESEND_SECONDS * 1000 - time) / 1000);
      if (wait > 0) return {sent: false, waitSeconds: wait};
    }
    const inWindow = current && time - current.window_start < 60 * MINUTE;
    if (inWindow && current.sends_in_window >= MAX_SENDS_PER_HOUR) {
      throw new OrderError("Too many codes were requested. Please try again in an hour.", 429);
    }
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    db.prepare(`INSERT INTO email_verifications(user_id,code_hash,expires_at,attempts,sent_at,window_start,sends_in_window)
      VALUES(?,?,?,0,?,?,1) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,
      attempts=0,sent_at=excluded.sent_at,window_start=?,sends_in_window=?`)
      .run(user.id, hashCode(user.id, code), time + CODE_MINUTES * MINUTE, time, time,
        inWindow ? current.window_start : time, inWindow ? current.sends_in_window + 1 : 1);
    try {
      await mailer.send({to: user.email, ...message(user.first_name, code)});
    } catch (error) {
      // Let the customer try again right away when the email could not be sent.
      db.prepare("UPDATE email_verifications SET sent_at=? WHERE user_id=?").run(time - RESEND_SECONDS * 1000, user.id);
      throw error;
    }
    return {sent: true, waitSeconds: RESEND_SECONDS};
  }

  // Checks a typed code. On success the account is marked verified.
  function verify(user, rawCode) {
    const code = typeof rawCode === "string" ? rawCode.replace(/\s/g, "") : "";
    const result = db.transaction(() => {
      const record = pending(user.id);
      if (!record) return true; // already verified
      if (!/^\d{6}$/.test(code)) throw new OrderError("Enter the 6-digit code from your email.");
      if (record.expires_at < now()) throw new OrderError("This code has expired. Tap “Resend code” to get a new one.", 410);
      if (record.attempts >= MAX_ATTEMPTS) throw new OrderError("Too many wrong codes. Tap “Resend code” to get a new one.", 429);
      if (!sameHash(record.code_hash, hashCode(user.id, code))) {
        // Counted outside the error: throwing here would roll the count back.
        db.prepare("UPDATE email_verifications SET attempts=attempts+1 WHERE user_id=?").run(user.id);
        const left = MAX_ATTEMPTS - record.attempts - 1;
        return {wrong: left > 0 ? `That code is incorrect. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong codes. Tap “Resend code” to get a new one."};
      }
      db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(now(), user.id);
      db.prepare("DELETE FROM email_verifications WHERE user_id=?").run(user.id);
      db.prepare("INSERT INTO account_audit(actor_id,subject_id,action) VALUES(?,?,?)").run(user.id, user.id, "Email verified");
      return true;
    }).immediate();
    if (result && result.wrong) throw new OrderError(result.wrong, 400);
    return true;
  }

  // Marks a new account as waiting for verification before the first email is sent.
  function markPending(userId) {
    db.prepare(`INSERT OR IGNORE INTO email_verifications(user_id,code_hash,expires_at,attempts,sent_at,window_start,sends_in_window)
      VALUES(?, '', 0, 0, 0, 0, 0)`).run(userId);
  }

  return {isPending: userId => Boolean(pending(userId)), markPending, sendCode, verify, maskEmail};
}

module.exports = {createEmailVerification, migrateEmailVerification, CODE_MINUTES, RESEND_SECONDS};
