const {OrderError} = require("./pricing");
const {createOrderWorkflow} = require("./orderWorkflow");

const rejectionMessage = "Your order has been canceled because your GCash payment was not received. If you believe you have paid, please contact the shop with your GCash receipt.";

function createPaymentReviewService(db) {
  const workflow = createOrderWorkflow(db);
  function reject(id, input, user) {
    if (user.role !== "Admin") throw new OrderError("Administrator access is required.", 403);
    if (input?.confirmedNotReceived !== true) throw new OrderError("Check your GCash account and confirm that payment was not received.");
    return db.transaction(() => {
      const order = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
      if (!order) throw new OrderError("Order was not found.", 404);
      // A retry must not restore stock twice or create another notification.
      if (order.status === "Canceled" && order.payment_rejected_at) return workflow.result(id);
      if (order.payment !== "GCash" || order.payment_status === "Verified" || !["New", "Preparing"].includes(order.status)) {
        throw new OrderError("Only an unverified GCash order awaiting preparation or delivery can be rejected.", 409);
      }
      workflow.cancel(id, user);
      db.prepare(`UPDATE orders SET payment_status='Not received', refund_status='Not required',
        cancellation_reason=?, payment_rejected_at=CURRENT_TIMESTAMP, payment_rejected_by=?,
        cancellation_acknowledged_at=NULL WHERE id=?`).run(rejectionMessage, user.id, id);
      return workflow.result(id);
    }).immediate();
  }
  // Admin or Staff confirm that the money actually arrived in the shop's GCash
  // account. The database records who confirmed it and when.
  function verify(id, input, user) {
    if (!["Admin", "Staff"].includes(user.role)) throw new OrderError("Administrator or staff access is required.", 403);
    return db.transaction(() => {
      const order = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
      if (!order) throw new OrderError("Order was not found.", 404);
      if (order.payment !== "GCash" || !order.payment_reference || order.status === "Canceled") {
        throw new OrderError("This order has no GCash payment available for verification.");
      }
      if (input?.confirmedReceived !== true) throw new OrderError("Check the reference and amount in your GCash account first.");
      if (order.payment_status === "Verified") return {message: "GCash payment was already verified."};
      db.prepare(`UPDATE orders SET payment_status='Verified',payment_verified_at=CURRENT_TIMESTAMP,payment_verified_by=?
        WHERE id=?`).run(user.id, order.id);
      return {message: "GCash payment marked as verified by staff."};
    }).immediate();
  }
  function pending(user) {
    return db.prepare(`SELECT id AS orderId, order_number AS orderNumber,
      cancellation_reason AS message, 'cancellation' AS type, 1 AS revision
      FROM orders WHERE user_id=? AND status='Canceled' AND (payment_rejected_at IS NOT NULL OR shop_rejected_at IS NOT NULL)
        AND cancellation_acknowledged_at IS NULL
      UNION ALL
      SELECT id, order_number, special_discount_note, 'discount', 1
      FROM orders WHERE user_id=? AND special_discount_status='Not approved' AND special_discount_note IS NOT NULL
        AND discount_notice_acknowledged_at IS NULL
      ORDER BY 1`).all(user.id, user.id);
  }
  // Customer read the "discount not approved" notice.
  function acknowledgeDiscount(id, user) {
    const updated = db.prepare(`UPDATE orders SET discount_notice_acknowledged_at=COALESCE(discount_notice_acknowledged_at,CURRENT_TIMESTAMP)
      WHERE id=? AND user_id=? AND special_discount_status='Not approved'`).run(id, user.id);
    if (!updated.changes) throw new OrderError("Discount notice was not found.", 404);
    return {message: "Discount notice acknowledged."};
  }
  function acknowledge(id, user) {
    const updated = db.prepare(`UPDATE orders SET cancellation_acknowledged_at=COALESCE(cancellation_acknowledged_at,CURRENT_TIMESTAMP)
      WHERE id=? AND user_id=? AND status='Canceled' AND (payment_rejected_at IS NOT NULL OR shop_rejected_at IS NOT NULL)`).run(id, user.id);
    if (!updated.changes) throw new OrderError("Cancellation notice was not found.", 404);
    return {message: "Cancellation notice acknowledged."};
  }
  return {reject, verify, pending, acknowledge, acknowledgeDiscount};
}
module.exports = {createPaymentReviewService, rejectionMessage};
