const {OrderError} = require("./pricing");

// ---- Fake-order and payment safeguards (panel feedback) -------------------
// 1. Cash on delivery and "pay at the store" pickup are limited to small
//    orders. Larger online orders must be prepaid by GCash, and GCash orders are
//    never prepared before staff see the money in the shop's GCash account.
// 2. Online orders get risk flags (first order, large order, earlier orders
//    the shop rejected, phone different from the account). A flagged cash
//    order can only be started after staff call or text the customer.
// 3. Admin or Staff can reject a New online order with a reason. Reserved
//    ingredients return to stock and the customer is notified.
// 4. Unverified GCash payments show how long they have waited; after
//    PAYMENT_FOLLOW_UP_MINUTES staff follow up instead of preparing.
// 5. Online Senior Citizen / PWD discounts need a photo of the ID card. The
//    Cashier or Admin look at the photo and verify it (like a GCash payment) before
//    the order can be prepared. If the ID is not approved, the order is NOT
//    canceled: the discount is removed, the order goes back to its normal
//    price and the customer receives a notice.
const COD_LIMIT = Object.freeze({maxTotal: 1500, maxItems: 10});
const PAYMENT_FOLLOW_UP_MINUTES = 5;
const LARGE_ORDER = Object.freeze({total: 1500, items: 10});
const REJECTION_REASONS = Object.freeze({
  unreachable: "We could not reach you at the phone number you gave to confirm this order.",
  address: "The delivery address was incomplete or could not be found.",
  duplicate: "This looks like a duplicate of another order you placed.",
  suspicious: "We could not confirm that this order is genuine.",
  other: ""
});
const SHOP_PHONE = "0955 431 6863";
// Optional GCash receipt screenshot: compressed JPEG/PNG/WebP data URL.
const MAX_PROOF_LENGTH = 360000;
const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
const ID_STATUSES = Object.freeze(["Pending verification", "Verified", "Not approved"]);

function migrateOrderSafety(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(orders)").all().map(row => row.name));
  for (const [name, sql] of Object.entries({
    shop_rejected_at: "TEXT",
    shop_rejected_by: "INTEGER REFERENCES users(id)",
    rejection_reason: "TEXT",
    customer_confirmed_at: "TEXT",
    customer_confirmed_by: "INTEGER REFERENCES users(id)",
    special_discount_status: "TEXT",
    special_discount_verified_at: "TEXT",
    special_discount_verified_by: "INTEGER REFERENCES users(id)",
    // Amount taken off the order when the ID was not approved, and the notice.
    special_discount_removed: "REAL NOT NULL DEFAULT 0",
    special_discount_note: "TEXT",
    discount_notice_acknowledged_at: "TEXT",
    // Pickup orders: when the order became ready, and when the customer read the notice.
    pickup_ready_at: "TEXT",
    pickup_notice_acknowledged_at: "TEXT",
    // The removed discount, when the customer pays it by GCash instead of cash.
    balance_payment_reference: "TEXT",
    balance_paid_at: "TEXT",
    balance_paid_by: "INTEGER REFERENCES users(id)"
  })) if (!columns.has(name)) db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${sql}`);
  db.exec(`CREATE TABLE IF NOT EXISTS order_payment_proofs (
    order_id INTEGER PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    image_data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS order_id_proofs (
    order_id INTEGER PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    image_data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  // Discounts saved before ID photos existed were already checked (registry or
  // physical ID at the counter), so they count as verified.
  db.prepare("UPDATE orders SET special_discount_status='Verified' WHERE special_discount_type IS NOT NULL AND special_discount_status IS NULL").run();
}

function itemCount(items) {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

// Unpaid online orders (cash on delivery, or pay at the store for pickup).
function cashOnDelivery(priced, serviceType = "Delivery") {
  const count = itemCount(priced.items);
  const allowed = priced.total <= COD_LIMIT.maxTotal && count <= COD_LIMIT.maxItems;
  const method = serviceType === "Pickup" ? "Paying at the store" : "Cash on delivery";
  return {allowed, maxTotal: COD_LIMIT.maxTotal, maxItems: COD_LIMIT.maxItems,
    message: allowed ? "" : `${method} is available for orders up to ₱${COD_LIMIT.maxTotal.toLocaleString("en-PH")} and ${COD_LIMIT.maxItems} items. Please pay this order by GCash.`};
}

// Online GCash orders must include a screenshot of the GCash receipt.
function paymentProof(value, payment) {
  if (value == null || value === "") {
    if (payment === "GCash") throw new OrderError("Attach the screenshot of your GCash receipt before placing the order.");
    return null;
  }
  if (payment !== "GCash") throw new OrderError("A payment screenshot can only be attached to a GCash order.");
  if (typeof value !== "string" || !IMAGE_DATA_URL.test(value)) {
    throw new OrderError("Attach the GCash receipt as a JPG, PNG or WebP image.");
  }
  if (value.length > MAX_PROOF_LENGTH) throw new OrderError("The GCash screenshot is too large. Please attach a smaller image.");
  return value;
}

// Photo of the Senior Citizen / PWD ID card, required for online discounts.
function idPhoto(value, special) {
  if (!special) {
    if (value == null || value === "") return null;
    throw new OrderError("An ID photo can only be attached when you apply the Senior Citizen / PWD discount.");
  }
  if (value == null || value === "") throw new OrderError(`Upload a clear photo of the ${special.type} ID to apply the discount.`);
  if (typeof value !== "string" || !IMAGE_DATA_URL.test(value)) throw new OrderError(`Upload the ${special.type} ID as a JPG, PNG or WebP image.`);
  if (value.length > MAX_PROOF_LENGTH) throw new OrderError("The ID photo is too large. Please upload a smaller image.");
  return value;
}

function createOrderSafety(db) {
  migrateOrderSafety(db);
  const history = db.prepare(`SELECT
      SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status='Canceled' AND (shop_rejected_at IS NOT NULL OR payment_rejected_at IS NOT NULL) THEN 1 ELSE 0 END) AS rejected
    FROM orders WHERE user_id=? AND id<>? AND order_type='Online'`);
  const account = db.prepare("SELECT phone FROM users WHERE id=?");
  const items = db.prepare("SELECT COALESCE(SUM(quantity),0) AS n FROM order_items WHERE order_id=?");

  function riskFlags(order) {
    if (order.order_type !== "Online") return [];
    const flags = [];
    const past = history.get(order.user_id, order.id);
    const count = items.get(order.id).n;
    if (!past.completed) flags.push({code: "first-order", label: "First order"});
    if (order.total >= LARGE_ORDER.total || count >= LARGE_ORDER.items) flags.push({code: "large-order", label: `Large order (${count} items)`});
    if (past.rejected) flags.push({code: "past-rejections", label: `${past.rejected} earlier order${past.rejected === 1 ? "" : "s"} rejected`});
    const phone = account.get(order.user_id)?.phone;
    if (phone && order.phone && phone.replace(/\D/g, "") !== order.phone.replace(/\D/g, "")) {
      flags.push({code: "different-phone", label: "Phone differs from account"});
    }
    return flags;
  }
  function needsPhoneConfirmation(order) {
    return order.order_type === "Online" && order.payment === "Cash" && !order.customer_confirmed_at && riskFlags(order).length > 0;
  }
  function paymentWait(order, now = Date.now()) {
    if (order.payment !== "GCash" || order.payment_status === "Verified" || order.status === "Canceled") return null;
    const created = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(order.created_at) ? order.created_at : order.created_at.replace(" ", "T") + "Z");
    const minutes = Math.max(0, Math.floor((now - created) / 60000));
    return {minutes, overdue: minutes >= PAYMENT_FOLLOW_UP_MINUTES, followUpMinutes: PAYMENT_FOLLOW_UP_MINUTES};
  }
  function describe(order) {
    return {riskFlags: riskFlags(order), needsPhoneConfirmation: needsPhoneConfirmation(order),
      paymentWait: paymentWait(order), hasPaymentProof: Boolean(db.prepare("SELECT 1 FROM order_payment_proofs WHERE order_id=?").get(order.id)),
      hasIdProof: Boolean(db.prepare("SELECT 1 FROM order_id_proofs WHERE order_id=?").get(order.id)),
      specialDiscountStatus: order.special_discount_type ? order.special_discount_status || "Verified" : null,
      discountRemoved: order.special_discount_removed || 0,
      // A GCash customer sent the discounted amount; the rest is collected on delivery,
      // unless it was already paid by GCash.
      balanceDue: order.payment === "GCash" && !order.balance_paid_at ? order.special_discount_removed || 0 : 0,
      balancePaidAt: order.balance_paid_at || null, balanceReference: order.balance_payment_reference || null,
      gcashAmount: order.payment === "GCash" ? Math.round((order.total - (order.special_discount_removed || 0)) * 100) / 100 : null,
      customerConfirmedAt: order.customer_confirmed_at || null, rejectionReason: order.rejection_reason || null};
  }
  function proof(id) {
    const row = db.prepare("SELECT image_data AS image, created_at AS createdAt FROM order_payment_proofs WHERE order_id=?").get(id);
    if (!row) throw new OrderError("No GCash screenshot was attached to this order.", 404);
    return row;
  }
  function idProof(id) {
    const row = db.prepare(`SELECT p.image_data AS image, p.created_at AS createdAt, o.special_discount_type AS type,
        o.special_discount_id AS idNumber, o.special_discount_name AS name, o.special_discount_status AS status
      FROM order_id_proofs p JOIN orders o ON o.id=p.order_id WHERE p.order_id=?`).get(id);
    if (!row) throw new OrderError("No Senior Citizen / PWD ID photo was uploaded for this order.", 404);
    return row;
  }
  // Cashier or Admin compared the photo with the name and ID number typed in.
  function verifyId(id, input, user) {
    if (!["Admin", "Cashier"].includes(user.role)) throw new OrderError("Administrator or cashier access is required.", 403);
    return db.transaction(() => {
      const order = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
      if (!order) throw new OrderError("Order was not found.", 404);
      if (!order.special_discount_type || order.status === "Canceled") throw new OrderError("This order has no Senior Citizen / PWD ID to verify.");
      if (order.special_discount_status === "Verified") return {message: "The ID was already verified."};
      if (input?.confirmedValid !== true) throw new OrderError("Compare the ID photo with the name and ID number first.");
      db.prepare(`UPDATE orders SET special_discount_status='Verified',special_discount_verified_at=CURRENT_TIMESTAMP,
        special_discount_verified_by=? WHERE id=?`).run(user.id, order.id);
      return {message: `${order.special_discount_type} ID verified. The discount stays on this order.`};
    }).immediate();
  }
  // The ID could not be approved: keep the order, remove the discount, return
  // the order to its normal price and tell the customer why.
  function disapproveId(id, input, user, workflow) {
    if (!["Admin", "Cashier"].includes(user.role)) throw new OrderError("Administrator or cashier access is required.", 403);
    const note = typeof input?.note === "string" ? input.note.trim().replace(/\s+/g, " ") : "";
    if (note.length > 200) throw new OrderError("Keep the note to 200 characters or fewer.");
    return db.transaction(() => {
      const order = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
      if (!order) throw new OrderError("Order was not found.", 404);
      if (!order.special_discount_type) throw new OrderError("This order has no Senior Citizen / PWD discount to review.");
      if (order.special_discount_status === "Not approved") return workflow.result(id);
      if (order.special_discount_status === "Verified") throw new OrderError("This ID was already verified.", 409);
      if (order.status === "Canceled") throw new OrderError("This order was canceled.", 409);
      const removedCents = Math.round((order.special_discount + order.vat_exempt) * 100);
      const totalCents = Math.round(order.total * 100) + removedCents;
      const peso = cents => "₱" + (cents / 100).toLocaleString("en-PH", {minimumFractionDigits: 2, maximumFractionDigits: 2});
      const pickup = order.service_type === "Pickup";
      const payNote = order.payment === "GCash"
        ? ` You already sent ${peso(totalCents - removedCents)} by GCash, so please pay the remaining ${peso(removedCents)} in cash ${pickup ? "at the store" : "to the rider"}, or send it by GCash using the same QR code and give the shop your reference number.`
        : ` Please pay ${peso(totalCents)} ${pickup ? "at the store when you pick up your order" : "to the rider"}.`;
      const message = `Your ${order.special_discount_type} discount for order ${order.order_number} was not approved because we could not verify the ID photo you uploaded.${note ? " " + note : ""} Your order will continue at the normal price of ${peso(totalCents)} (the ${peso(removedCents)} discount was removed).${payNote} If you think this is a mistake, please contact Kopi; Calamba at ${SHOP_PHONE}.`;
      db.prepare(`UPDATE orders SET special_discount_status='Not approved',special_discount_verified_at=CURRENT_TIMESTAMP,
        special_discount_verified_by=?,special_discount_removed=?,special_discount=0,vat_exempt=0,total=?,
        special_discount_note=?,discount_notice_acknowledged_at=NULL WHERE id=?`)
        .run(user.id, removedCents / 100, totalCents / 100, message, id);
      return workflow.result(id);
    }).immediate();
  }
  // The ID was not approved, so the discount came off and a balance remains. This
  // records that the customer sent that balance by GCash instead of paying cash.
  function payBalanceByGcash(id, input, user) {
    if (!["Admin", "Cashier"].includes(user.role)) throw new OrderError("Administrator or cashier access is required.", 403);
    const reference = typeof input?.reference === "string" ? input.reference.trim() : "";
    if (!/^[0-9]{13}$/.test(reference)) throw new OrderError("Enter the 13-digit GCash reference number (numbers only).");
    if (input?.confirmedReceived !== true) throw new OrderError("Check the reference and amount in the shop's GCash account first.");
    return db.transaction(() => {
      const order = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
      if (!order) throw new OrderError("Order was not found.", 404);
      if (order.balance_paid_at) return {message: "The remaining balance was already paid by GCash."};
      if (order.payment !== "GCash" || !(order.special_discount_removed > 0) || order.status === "Canceled") {
        throw new OrderError("This order has no remaining GCash balance to pay.", 409);
      }
      const used = db.prepare(`SELECT 1 FROM orders WHERE (payment='GCash' AND payment_reference=?) OR balance_payment_reference=?`).get(reference, reference);
      if (used) throw new OrderError("That GCash reference is already attached to an order.", 409);
      db.prepare("UPDATE orders SET balance_payment_reference=?,balance_paid_at=CURRENT_TIMESTAMP,balance_paid_by=? WHERE id=?").run(reference, user.id, id);
      return {message: "Remaining balance marked as paid by GCash."};
    }).immediate();
  }
  function confirmCustomer(order, user) {
    db.prepare("UPDATE orders SET customer_confirmed_at=COALESCE(customer_confirmed_at,CURRENT_TIMESTAMP),customer_confirmed_by=COALESCE(customer_confirmed_by,?) WHERE id=?")
      .run(user.id, order.id);
  }
  function reject(id, input, user, workflow) {
    if (!["Admin", "Cashier", "Staff"].includes(user.role)) throw new OrderError("Administrator or staff access is required.", 403);
    const code = input?.reason;
    if (!Object.hasOwn(REJECTION_REASONS, code)) throw new OrderError("Choose a reason for rejecting this order.");
    const note = typeof input?.note === "string" ? input.note.trim().replace(/\s+/g, " ") : "";
    if (note.length > 200) throw new OrderError("Keep the note to 200 characters or fewer.");
    if (code === "other" && note.length < 5) throw new OrderError("Explain the reason in a short note.");
    return db.transaction(() => {
      const order = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
      if (!order) throw new OrderError("Order was not found.", 404);
      if (order.status === "Canceled" && order.shop_rejected_at) return workflow.result(id);
      if (order.order_type !== "Online" || order.status !== "New") {
        throw new OrderError("Only a new online order can be rejected. Once preparation starts, an administrator cancels it from Operations.", 409);
      }
      workflow.cancel(id, user, {asShop: true});
      const reason = [REJECTION_REASONS[code], note].filter(Boolean).join(" ");
      const message = `Your order ${order.order_number} was canceled by the shop. ${reason} If this is a mistake, please contact Kopi; Calamba at ${SHOP_PHONE}.`;
      db.prepare(`UPDATE orders SET shop_rejected_at=CURRENT_TIMESTAMP,shop_rejected_by=?,rejection_reason=?,
        cancellation_reason=?,cancellation_acknowledged_at=NULL WHERE id=?`).run(user.id, code + (note ? ": " + note : ""), message, id);
      return workflow.result(id);
    }).immediate();
  }
  return {riskFlags, needsPhoneConfirmation, paymentWait, describe, proof, idProof, verifyId, disapproveId, payBalanceByGcash, confirmCustomer, reject};
}

module.exports = {createOrderSafety, migrateOrderSafety, cashOnDelivery, paymentProof, idPhoto, ID_STATUSES, COD_LIMIT, PAYMENT_FOLLOW_UP_MINUTES, REJECTION_REASONS};
