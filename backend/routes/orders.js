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
  router.post("/quote",(request,response)=>{
    try { response.json(workflow.prepareQuote(request.body||{})); }
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
        refund_status AS refundStatus,inventory_state AS inventoryState,total,
        cancellation_reason AS cancellationReason,
        rider_fee_cents / 100.0 AS riderFee,delivery_tracking_url AS trackingUrl,
        delivery_message AS deliveryMessage,delivery_revision AS deliveryRevision,
        delivery_acknowledged_at AS deliveryAcknowledgedAt,
        created_at AS createdAt,completed_at AS completedAt,canceled_at AS canceledAt
      FROM orders WHERE user_id=? ORDER BY id DESC
    `).all(request.user.id);
    response.json({orders});
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
