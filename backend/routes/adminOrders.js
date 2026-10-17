const express = require("express");
const { authFor,requireRole } = require("../middleware/auth");
const { sendError } = require("../services/orderWorkflow");

module.exports = function adminOrderRouter(db) {
  const router = express.Router();
  const requireAuth = authFor(db);
  const delivery = require("../services/delivery").createDeliveryService(db);
  const paymentReview = require("../services/paymentReview").createPaymentReviewService(db);
  router.use(requireAuth,requireRole("Admin"));
  router.get("/orders",(request,response)=>{
    const orders = db.prepare(`
      SELECT orders.id,orders.order_number AS orderNumber,orders.order_type AS orderType,
        orders.service_type AS serviceType,orders.status,orders.payment,
        orders.payment_reference AS paymentReference,orders.payment_status AS paymentStatus,
        orders.inventory_state AS inventoryState,orders.refund_status AS refundStatus,
        orders.cancellation_reason AS cancellationReason,
        orders.address,orders.phone,orders.total,
        orders.rider_fee_cents / 100.0 AS riderFee,orders.delivery_tracking_url AS trackingUrl,
        orders.delivery_message AS deliveryMessage,orders.delivery_revision AS deliveryRevision,
        orders.delivery_acknowledged_at AS deliveryAcknowledgedAt,
        (SELECT COALESCE(SUM(quantity),0) FROM order_items WHERE order_id=orders.id) AS itemCount,
        orders.created_at AS createdAt,
        COALESCE(NULLIF(orders.customer_name,''),users.first_name||' '||users.last_name) AS customer
      FROM orders JOIN users ON users.id=orders.user_id ORDER BY orders.id DESC
    `).all();
    response.json({orders});
  });
  router.put("/orders/:id/delivery", (request, response) => {
    try { response.json({delivery: delivery.save(request.params.id, request.body || {}, request.user)}); }
    catch (error) { sendError(response, error); }
  });
  router.patch("/orders/:id/verify-payment",(request,response)=>{
    const order = db.prepare("SELECT * FROM orders WHERE id=?").get(request.params.id);
    if (!order) return response.status(404).json({message:"Order was not found."});
    if (order.payment!=="GCash" || !order.payment_reference || order.status==="Canceled") {
      return response.status(400).json({message:"This order has no GCash payment available for verification."});
    }
    if (request.body?.confirmedReceived!==true) return response.status(400).json({message:"Check the reference and amount in your GCash account first."});
    const updated = db.prepare(`UPDATE orders SET payment_status='Verified',payment_verified_at=CURRENT_TIMESTAMP,payment_verified_by=?
      WHERE id=? AND payment_status!='Verified' AND status!='Canceled'`).run(request.user.id,order.id);
    if (!updated.changes && order.payment_status !== "Verified") return response.status(409).json({message:"This order changed. Refresh its payment details before continuing."});
    response.json({message:"GCash payment marked as verified by staff."});
  });
  router.patch("/orders/:id/reject-payment", (request, response) => {
    try {
      const order = paymentReview.reject(request.params.id, request.body, request.user);
      response.json({...order, message: "Order canceled. The customer will receive a payment-not-received notice."});
    } catch (error) { sendError(response, error); }
  });
  return router;
};
