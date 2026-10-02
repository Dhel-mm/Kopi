const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../..");

function authHarness({id = "loginForm", values = {email: "test@example.com", password: "test"}, error, role = "Customer"} = {}) {
  let handler;
  const submit = {disabled: false};
  const status = {};
  const messages = [];
  const timers = [];
  const calls = [];
  const form = {id, querySelector: () => submit, addEventListener: (_, fn) => {handler = fn;}, reset() {}};
  const context = {
    document: {querySelectorAll: () => [], querySelector: () => form, getElementById: name => name === "authStatus" ? status : {checked: false}},
    FormData: class { constructor() {return Object.entries(values);} },
    KopiNotice: {set: (_, message, kind) => messages.push({message, kind}), toast: (message, kind) => messages.push({message, kind, toast: true})},
    KopiApi: {request: async (...args) => {calls.push(args); if (error) throw new Error(error); return {user: {role}, token: "test-token"};}, saveSession() {}, clearSession() {}},
    localStorage: {removeItem() {}},
    window: {location: {href: ""}},
    setTimeout: resolve => {timers.push(resolve);}
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "Auth.js"), "utf8"), context);
  return {run: () => handler({preventDefault() {}}), context, submit, messages, timers, calls};
}

test("login shows loading then success toast before redirect, and blocks duplicate submits", async () => {
  const h = authHarness();
  const pending = h.run();
  assert.equal(h.messages[0].kind, "loading");
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(h.messages.some(m => m.toast && m.kind === "success"));
  assert.equal(h.context.window.location.href, "");
  await h.run();
  assert.equal(h.calls.length, 1);
  h.timers[0]();
  await pending;
  assert.equal(h.context.window.location.href, "Customer/Homepage.html");
});

test("admin login retains its dashboard destination", async () => {
  const h = authHarness({role: "Admin"});
  const pending = h.run();
  await new Promise(resolve => setImmediate(resolve));
  h.timers[0]();
  await pending;
  assert.equal(h.context.window.location.href, "Admin/Dashboard.html");
});

test("failed login shows an error and allows retry without redirecting", async () => {
  const h = authHarness({error: "Incorrect email or password, or account inactive."});
  await h.run();
  assert.equal(h.messages.at(-1).kind, "error");
  assert.equal(h.submit.disabled, false);
  assert.equal(h.context.window.location.href, "");
  assert.equal(h.messages.some(m => m.toast), false);
});

test("recovery rejects mismatched passwords before sending a request", async () => {
  const h = authHarness({id: "resetForm", values: {password: "one", confirmPassword: "two"}});
  await h.run();
  assert.equal(h.calls.length, 0);
  assert.equal(h.messages.at(-1).kind, "error");
});

test("shared notices classify loading, errors, warnings and success", () => {
  const context = {
    window: {},
    document: {body: {}, querySelectorAll: () => []},
    MutationObserver: class {observe() {}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "Customer/Notices.js"), "utf8"), context);
  const {kindFor, set} = context.window.KopiNotice;
  for (const [message, kind] of [
    ["Please wait…", "loading"],
    ["Incorrect email or password, or account inactive.", "error"],
    ["Please select a size.", "warning"],
    ["Successfully logged in", "success"],
    ["Thank you for your feedback.", "success"]
  ]) assert.equal(kindFor(message), kind);
  const node = {dataset: {}, classList: {add() {}}, setAttribute() {}};
  set(node, "<img src=x onerror=alert(1)>", "error");
  assert.equal(node.textContent, "<img src=x onerror=alert(1)>");
  assert.equal(node.dataset.noticeType, "error");
});
