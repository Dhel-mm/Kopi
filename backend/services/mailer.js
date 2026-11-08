// Sends the verification emails. Choose one way in backend/.env:
//
// 1. Gmail (good for running the system on your own computer):
//      SMTP_USER=yourshop@gmail.com
//      SMTP_PASS=the 16-letter Google "App password" (not your normal password)
//      SMTP_HOST / SMTP_PORT are optional: smtp.gmail.com and 465 by default.
// 2. Brevo's HTTPS API (for hosting that blocks SMTP, such as Render's free plan):
//      BREVO_API_KEY=...  and  MAIL_FROM=a sender address verified in Brevo
// MAIL_FROM_NAME is the optional display name, default "Kopi; Calamba".
// With neither set, development mode prints the email in the server window
// instead of sending it, and production mode refuses to send.
const net = require("node:net");
const tls = require("node:tls");
const crypto = require("node:crypto");
const {OrderError} = require("./pricing");

// A small SMTP client: TLS on port 465 and AUTH LOGIN, which is what Gmail needs.
function smtpSend({host, port, secure, user, pass, from, fromName, to, subject, text, html, timeout = 15000}) {
  const b64 = value => Buffer.from(value, "utf8").toString("base64");
  const wrap = value => b64(value).replace(/.{1,76}/g, "$&\r\n");
  const boundary = "kopi-" + crypto.randomUUID();
  const domain = (from.split("@")[1] || "localhost").replace(/[^\w.-]/g, "");
  const message = [
    `From: =?UTF-8?B?${b64(fromName)}?= <${from}>`, `To: <${to}>`, `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@${domain}>`, "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap(text),
    ...(html ? [`--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap(html)] : []),
    `--${boundary}--`, ""].join("\r\n");
  return new Promise((resolve, reject) => {
    const socket = secure ? tls.connect({host, port, servername: host}) : net.connect({host, port});
    let buffer = "", waiting = null, done = false;
    const finish = error => {
      if (done) return;
      done = true;
      socket.end();
      error ? reject(error) : resolve();
    };
    socket.setTimeout(timeout, () => finish(Object.assign(new Error("SMTP timeout"), {name: "SmtpTimeout"})));
    socket.on("error", finish);
    socket.on("close", () => finish(Object.assign(new Error("SMTP connection closed"), {name: "SmtpClosed"})));
    // A reply is finished by a line such as "250 OK"; "250-..." means more lines follow.
    const drain = () => {
      if (!waiting) return;
      const lines = buffer.split("\r\n");
      const complete = lines.slice(0, -1);
      const last = complete.findIndex(line => /^\d{3}(?: |$)/.test(line));
      if (last < 0) return;
      buffer = lines.slice(last + 1).join("\r\n");
      const next = waiting;
      waiting = null;
      next(Number(complete[last].slice(0, 3)));
    };
    socket.on("data", chunk => { buffer += chunk.toString("utf8"); drain(); });
    const expect = (codes, command) => new Promise((ok, fail) => {
      waiting = code => codes.includes(code) ? ok(code)
        : fail(Object.assign(new Error("SMTP refused with " + code), {name: "SmtpRefused", code: String(code)}));
      if (command !== undefined) socket.write(command + "\r\n");
      drain();
    });
    (async () => {
      await expect([220]);
      await expect([250], "EHLO kopi.local");
      await expect([334], "AUTH LOGIN");
      await expect([334], b64(user));
      await expect([235], b64(pass));
      await expect([250], `MAIL FROM:<${from}>`);
      await expect([250, 251], `RCPT TO:<${to}>`);
      await expect([354], "DATA");
      await expect([250], message + "\r\n.");
      socket.write("QUIT\r\n");
      finish();
    })().catch(finish);
  });
}

function createMailer(env = process.env, {fetchImpl = globalThis.fetch, log = console, smtpImpl = smtpSend} = {}) {
  const key = env.BREVO_API_KEY || "";
  const smtpUser = (env.SMTP_USER || "").trim();
  const smtpPass = (env.SMTP_PASS || "").replace(/\s/g, ""); // Google shows app passwords with spaces
  const name = env.MAIL_FROM_NAME || "Kopi; Calamba";
  const production = env.NODE_ENV === "production";
  const method = key && env.MAIL_FROM ? "brevo" : smtpUser && smtpPass ? "smtp" : "none";
  const from = env.MAIL_FROM || smtpUser;
  const configured = method !== "none";

  async function send({to, subject, text, html}) {
    if (method === "smtp") {
      const port = Number(env.SMTP_PORT || 465);
      try {
        await smtpImpl({host: env.SMTP_HOST || "smtp.gmail.com", port, secure: env.SMTP_SECURE ? env.SMTP_SECURE !== "false" : port === 465,
          user: smtpUser, pass: smtpPass, from, fromName: name, to, subject, text, html});
      } catch (error) {
        log.error("Email could not be sent:", error.name, error.code || "",
          error.code === "535" ? "(Gmail refused the login: use a Google App password in SMTP_PASS)" : "");
        throw new OrderError("We could not send the email right now. Please try again in a few minutes.", 502);
      }
      return {delivered: true};
    }
    if (!configured) {
      if (production) throw new OrderError("Email is not set up on the server yet. Please contact the shop.", 503);
      log.log(`\n[Email not configured: development only, nothing was sent]\nTo: ${to}\nSubject: ${subject}\n${text}\n`);
      return {delivered: false, logged: true};
    }
    let response;
    try {
      response = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {"api-key": key, "Content-Type": "application/json", accept: "application/json"},
        body: JSON.stringify({sender: {name, email: from}, to: [{email: to}], subject, textContent: text, htmlContent: html}),
        signal: AbortSignal.timeout(10000)
      });
    } catch (error) {
      log.error("Email could not be sent:", error.name);
      throw new OrderError("We could not send the email right now. Please try again in a few minutes.", 502);
    }
    if (!response.ok) {
      log.error("Email could not be sent: Brevo answered HTTP " + response.status);
      throw new OrderError("We could not send the email right now. Please try again in a few minutes.", 502);
    }
    return {delivered: true};
  }

  return {configured, method, send};
}

module.exports = {createMailer, smtpSend};
