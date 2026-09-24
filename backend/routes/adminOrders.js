const express = require("express");
const { authFor,requireRole } = require("../middleware/auth");
const { createOrderWorkflow,sendError } = require("../services/orderWorkflow");

module.exports = function adminOrderRouter(db) {
  const router = express.Router();
  const requireAuth = authFor(db);
  const workflow = createOrderWorkflow(db);
  router.use(requireAuth,requireRole("Admin"));
  router.get("/orders/requests/:key",(request,response)=>{
    try { response.json(workflow.recover(request.params.key,request.user,true)); }
    catch(error) { sendError(response,error); }
  });
  router.get("/orders",(request,response)=>{
    const orders = db.prepare(`
      SELECT orders.id,orders.order_number AS orderNumber,orders.order_type AS orderType,
        orders.service_type AS serviceType,orders.status,orders.payment,
        orders.payment_reference AS paymentReference,orders.payment_status AS paymentStatus,
        orders.inventory_state AS inventoryState,orders.refund_status AS refundStatus,
        orders.address,orders.phone,orders.total,
        (SELECT COALESCE(SUM(quantity),0) FROM order_items WHERE order_id=orders.id) AS itemCount,
        orders.created_at AS createdAt,
        COALESCE(NULLIF(orders.customer_name,''),users.first_name||' '||users.last_name) AS customer
      FROM orders JOIN users ON users.id=orders.user_id ORDER BY orders.id DESC
    `).all();
    response.json({orders});
  });
  router.post("/orders/quote",(request,response)=>{
    try { response.json(workflow.prepareQuote(request.body||{},true)); }
    catch(error) { sendError(response,error); }
  });
  router.post("/orders",(request,response)=>{
    try { response.status(201).json(workflow.create(request.body||{},request.user,true)); }
    catch(error) { sendError(response,error); }
  });
  router.patch("/orders/:id/status",(request,response)=>{
    try { response.json(workflow.advance(request.params.id,request.body?.status,request.user)); }
    catch(error) { sendError(response,error); }
  });
  router.patch("/orders/:id/verify-payment",(request,response)=>{
    const order = db.prepare("SELECT * FROM orders WHERE id=?").get(request.params.id);
    if (!order) return response.status(404).json({message:"Order was not found."});
    if (order.payment!=="GCash" || !order.payment_reference || order.status==="Canceled") {
      return response.status(400).json({message:"This order has no GCash payment available for verification."});
    }
    if (request.body?.confirmedReceived!==true) return response.status(400).json({message:"Check the reference and amount in your GCash account first."});
    db.prepare(`UPDATE orders SET payment_status='Verified',payment_verified_at=CURRENT_TIMESTAMP,payment_verified_by=?
      WHERE id=? AND payment_status!='Verified'`).run(request.user.id,order.id);
    response.json({message:"GCash payment marked as verified by staff."});
  });
  return router;
};
