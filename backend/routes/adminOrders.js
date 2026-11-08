const express = require("express");
const { authFor,requireRole } = require("../middleware/auth");
const { sendError } = require("../services/orderWorkflow");

module.exports = function adminOrderRouter(db) {
  const router = express.Router();
  const requireAuth = authFor(db);
  const delivery = require("../services/delivery").createDeliveryService(db);
  const paymentReview = require("../services/paymentReview").createPaymentReviewService(db);
  const safety = require("../services/orderSafety").createOrderSafety(db);
  const workflow = require("../services/orderWorkflow").createOrderWorkflow(db);
  const rowFor = db.prepare("SELECT * FROM orders WHERE id=?");
  router.use(requireAuth,requireRole("Admin"));
  // GCash payments and Senior Citizen / PWD IDs waiting for verification, for the Admin pop-up alert.
  router.get("/alerts",(request,response)=>{
    response.json(require("../services/alerts").createAlertService(db).admin());
  });
  router.get("/orders",(request,response)=>{
    const orders = db.prepare(`
      SELECT orders.id,orders.order_number AS orderNumber,orders.order_type AS orderType,
        orders.service_type AS serviceType,orders.scheduled_for AS scheduledFor,orders.status,orders.payment,
        orders.payment_reference AS paymentReference,orders.payment_status AS paymentStatus,
        orders.inventory_state AS inventoryState,orders.refund_status AS refundStatus,
        orders.cancellation_reason AS cancellationReason,
        orders.address,orders.phone,orders.subtotal,orders.voucher,orders.voucher_discount AS voucherDiscount,orders.total,
        orders.special_discount_type AS specialDiscountType,orders.special_discount_id AS specialDiscountId,orders.special_discount_name AS specialDiscountName,orders.special_discount AS specialDiscount,orders.vat_exempt AS vatExempt,
        orders.special_discount_status AS specialDiscountStatus,
        orders.rider_fee_cents / 100.0 AS riderFee,orders.delivery_tracking_url AS trackingUrl,
        orders.delivery_message AS deliveryMessage,orders.delivery_revision AS deliveryRevision,
        orders.delivery_acknowledged_at AS deliveryAcknowledgedAt,
        (SELECT COALESCE(SUM(quantity),0) FROM order_items WHERE order_id=orders.id) AS itemCount,
        orders.created_at AS createdAt,
        COALESCE(NULLIF(orders.customer_name,''),users.first_name||' '||users.last_name) AS customer
      FROM orders JOIN users ON users.id=orders.user_id ORDER BY orders.id DESC
    `).all();
    response.json({orders:orders.map(order => ({...order,...safety.describe(rowFor.get(order.id))}))});
  });
  // Receipt for any order (online or in-store), used by the Transactions page.
  router.get("/orders/:id/receipt",(request,response)=>{
    const order=db.prepare(`SELECT o.id,o.order_number AS orderNumber,o.order_type AS orderType,o.service_type AS serviceType,
        o.status,o.payment,o.payment_status AS paymentStatus,o.payment_reference AS paymentReference,
        o.subtotal,o.voucher,o.voucher_discount AS voucherDiscount,o.special_discount_type AS specialDiscountType,
        o.special_discount_id AS specialDiscountId,o.special_discount_name AS specialDiscountName,
        o.special_discount AS specialDiscount,o.vat_exempt AS vatExempt,o.special_discount_status AS specialDiscountStatus,
        o.special_discount_removed AS discountRemoved,o.total,o.cash_tendered AS cashTendered,
        o.cash_change AS cashChange,o.address,o.phone,o.cancellation_reason AS cancellationReason,o.refund_status AS refundStatus,
        o.created_at AS createdAt,o.completed_at AS completedAt,o.canceled_at AS canceledAt,
        COALESCE(NULLIF(o.customer_name,''),u.first_name||' '||u.last_name) AS customer,
        CASE WHEN o.order_type='In-store' THEN u.first_name||' '||u.last_name ELSE 'Online checkout' END AS cashier
      FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?`).get(request.params.id);
    if (!order) return response.status(404).json({message:"Order was not found."});
    const items=db.prepare("SELECT product_name AS name,quantity,price,options_json FROM order_items WHERE order_id=? ORDER BY id").all(order.id)
      .map(item=>({name:item.name,quantity:item.quantity,price:item.price,options:JSON.parse(item.options_json)}));
    response.json({order:{...order,items}});
  });
  router.patch("/orders/:id/reject",(request,response)=>{
    try {response.json({...safety.reject(request.params.id, request.body || {}, request.user, workflow), message:"Order rejected. Reserved ingredients were returned and the customer will be notified."});}
    catch (error) {sendError(response, error);}
  });
  router.get("/orders/:id/payment-proof",(request,response)=>{
    try {response.json(safety.proof(request.params.id));}
    catch (error) {sendError(response, error);}
  });
  // Senior Citizen / PWD ID photo uploaded at online checkout.
  router.get("/orders/:id/id-proof",(request,response)=>{
    try {response.json(safety.idProof(request.params.id));}
    catch (error) {sendError(response, error);}
  });
  router.patch("/orders/:id/verify-id",(request,response)=>{
    try {response.json(safety.verifyId(request.params.id, request.body || {}, request.user));}
    catch (error) {sendError(response, error);}
  });
  router.patch("/orders/:id/not-approve-id",(request,response)=>{
    try {response.json({...safety.disapproveId(request.params.id, request.body || {}, request.user, workflow), message:"Discount not approved. The order continues at the normal price and the customer will be notified."});}
    catch (error) {sendError(response, error);}
  });
  router.put("/orders/:id/delivery", (request, response) => {
    try { response.json({delivery: delivery.save(request.params.id, request.body || {}, request.user)}); }
    catch (error) { sendError(response, error); }
  });
  router.patch("/orders/:id/verify-payment",(request,response)=>{
    try { response.json(paymentReview.verify(request.params.id, request.body, request.user)); }
    catch (error) { sendError(response, error); }
  });
  // The ID was not approved: the customer sends the removed discount by GCash.
  router.patch("/orders/:id/balance-gcash",(request,response)=>{
    try { response.json(safety.payBalanceByGcash(request.params.id, request.body || {}, request.user)); }
    catch (error) { sendError(response, error); }
  });
  router.patch("/orders/:id/reject-payment", (request, response) => {
    try {
      const order = paymentReview.reject(request.params.id, request.body, request.user);
      response.json({...order, message: "Order canceled. The customer will receive a payment-not-received notice."});
    } catch (error) { sendError(response, error); }
  });
  return router;
};
