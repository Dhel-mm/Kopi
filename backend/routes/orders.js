const express = require("express");
const { authFor, requireRole } = require("../middleware/auth");
const { createOrderWorkflow,sendError } = require("../services/orderWorkflow");

module.exports = function orderRouter(db) {
  const router = express.Router();
  const requireAuth = authFor(db);
  const workflow = createOrderWorkflow(db);
  const delivery = require("../services/delivery").createDeliveryService(db);
  const paymentReview = require("../services/paymentReview").createPaymentReviewService(db);
  router.use(requireAuth, requireRole("Customer", "Admin"));
  router.get("/notifications", requireRole("Customer"), (request, response) => {
    response.json({notifications: [...paymentReview.pending(request.user),
      ...delivery.pending(request.user).map(notice => ({...notice, type: "delivery"}))]});
  });
  router.patch("/:id/cancellation/acknowledge", requireRole("Customer"), (request, response) => {
    try { response.json(paymentReview.acknowledge(request.params.id, request.user)); }
    catch (error) { sendError(response, error); }
  });
  router.patch("/:id/discount/acknowledge", requireRole("Customer"), (request, response) => {
    try { response.json(paymentReview.acknowledgeDiscount(request.params.id, request.user)); }
    catch (error) { sendError(response, error); }
  });
  router.patch("/:id/pickup/acknowledge", requireRole("Customer"), (request, response) => {
    try { response.json(paymentReview.acknowledgePickup(request.params.id, request.user)); }
    catch (error) { sendError(response, error); }
  });
  router.get("/delivery-notifications", requireRole("Customer"), (request, response) => {
    response.json({notifications: delivery.pending(request.user)});
  });
  router.patch("/:id/delivery/acknowledge", requireRole("Customer"), (request, response) => {
    try { response.json({delivery: delivery.acknowledge(request.params.id, request.body?.revision, request.user)}); }
    catch (error) { sendError(response, error); }
  });
  router.get("/requests/:key",(request,response)=>{
    try { response.json(workflow.recover(request.params.key,request.user)); }
    catch(error) { sendError(response,error); }
  });
  // Times a customer may choose for pickup or rider handover (opening hours only).
  router.get("/schedule",(request,response)=>{
    response.json(require("../services/schedule").options());
  });
  router.post("/quote",(request,response)=>{
    try { response.json(workflow.prepareQuote(request.body||{})); }
    catch(error) { sendError(response,error,true); }
  });
  // Checked when adding to the cart: does the shop have enough ingredients for this much?
  router.post("/stock-check",(request,response)=>{
    try { response.json(workflow.stockCheck(request.body||{})); }
    catch(error) { sendError(response,error,true); }
  });
  router.post("/",(request,response)=>{
    try { response.status(201).json(workflow.create(request.body||{},request.user)); }
    catch(error) { sendError(response,error,true); }
  });
  router.get("/my",(request,response)=>{
    const orders = db.prepare(`
      SELECT id,order_number AS orderNumber,order_type AS orderType,status,payment,
        payment_reference AS paymentReference,payment_status AS paymentStatus,
        refund_status AS refundStatus,inventory_state AS inventoryState,subtotal,voucher_discount AS voucherDiscount,total,
        special_discount_type AS specialDiscountType,special_discount_id AS specialDiscountId,special_discount_name AS specialDiscountName,special_discount AS specialDiscount,vat_exempt AS vatExempt,
        special_discount_status AS specialDiscountStatus,special_discount_removed AS discountRemoved,balance_paid_at AS balancePaidAt,service_type AS serviceType,scheduled_for AS scheduledFor,
        cancellation_reason AS cancellationReason,
        rider_fee_cents / 100.0 AS riderFee,delivery_tracking_url AS trackingUrl,
        delivery_message AS deliveryMessage,delivery_revision AS deliveryRevision,
        delivery_acknowledged_at AS deliveryAcknowledgedAt,
        created_at AS createdAt,completed_at AS completedAt,canceled_at AS canceledAt
      FROM orders WHERE user_id=? ORDER BY id DESC
    `).all(request.user.id);
    response.json({orders});
  });
  // Receipt of one of the customer's own orders (My Orders > View receipt).
  router.get("/:id/receipt", (request, response) => {
    const order = db.prepare(`
      SELECT id,order_number AS orderNumber,order_type AS orderType,service_type AS serviceType,scheduled_for AS scheduledFor,status,payment,
        payment_status AS paymentStatus,payment_reference AS paymentReference,subtotal,delivery_fee AS deliveryFee,
        voucher,voucher_discount AS voucherDiscount,special_discount_type AS specialDiscountType,
        special_discount_id AS specialDiscountId,special_discount_name AS specialDiscountName,
        special_discount AS specialDiscount,vat_exempt AS vatExempt,special_discount_status AS specialDiscountStatus,
        special_discount_removed AS discountRemoved,total,cash_tendered AS cashTendered,cash_change AS cashChange,
        address,created_at AS createdAt,completed_at AS completedAt,canceled_at AS canceledAt
      FROM orders WHERE id=? AND user_id=?
    `).get(request.params.id, request.user.id);
    if (!order) return response.status(404).json({message:"Order was not found."});
    const items = db.prepare("SELECT product_name AS name,quantity,price,options_json FROM order_items WHERE order_id=? ORDER BY id")
      .all(order.id).map(item => ({name:item.name,quantity:item.quantity,price:item.price,options:JSON.parse(item.options_json)}));
    response.json({order:{...order,items}});
  });
  router.patch("/:id/cancel",(request,response)=>{
    try {
      const order = workflow.cancel(request.params.id,request.user);
      response.json({message:order.inventoryState==="returned"
        ?"Order canceled. Reserved ingredients were returned to stock."
        :"Order canceled. Preparation had started, so ingredients remain deducted.",...order});
    } catch(error) { sendError(response,error); }
  });
  return router;
};
