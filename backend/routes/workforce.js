const express = require("express");
const {authFor, requireRole} = require("../middleware/auth");
const {createOrderWorkflow, sendError} = require("../services/orderWorkflow");
const {OrderError} = require("../services/pricing");
const {lowStockLevel, round} = require("../services/inventory");
const {createDeliveryService} = require("../services/delivery");

// Employee workspaces deliberately do not reuse the unrestricted Admin API.
module.exports = function workforceRouter(db) {
  const router = express.Router();
  const workflow = createOrderWorkflow(db);
  const delivery = createDeliveryService(db);
  const availability = require("../services/productAvailability").createProductAvailability(db);
  const paymentReview = require("../services/paymentReview").createPaymentReviewService(db);
  const cashier = requireRole("Cashier");
  const staff = requireRole("Admin", "Staff");
  router.use(authFor(db), requireRole("Admin", "Cashier", "Staff"));

  const itemsFor = db.prepare(`SELECT product_name AS name,quantity,price,options_json
    FROM order_items WHERE order_id=? ORDER BY id`);
  function items(id, includePrice = false) {
    return itemsFor.all(id).map(row => ({name:row.name,quantity:row.quantity,
      options:JSON.parse(row.options_json),...(includePrice ? {price:row.price} : {})}));
  }

  router.get("/orders", cashier, (req, res) => {
    const orders = db.prepare(`SELECT o.id,o.order_number AS orderNumber,o.status,
      o.service_type AS serviceType,o.customer_name AS customer,o.payment,
      o.payment_status AS paymentStatus,o.total,o.created_at AS createdAt,
      u.first_name || ' ' || u.last_name AS cashier,
      (SELECT SUM(quantity) FROM order_items WHERE order_id=o.id) AS itemCount
      FROM orders o JOIN users u ON u.id=o.user_id
      WHERE o.order_type='In-store' ORDER BY o.id DESC LIMIT 250`).all();
    res.json({orders});
  });
  router.get("/orders/requests/:key", cashier, (req, res) => {
    try {res.json(workflow.recover(req.params.key, req.user, true));}
    catch (error) {sendError(res, error);}
  });
  router.get("/orders/availability", cashier, (req, res) => {
    try {res.json({products: availability.list(req.query.serviceType || "Dine-in")});}
    catch (error) {sendError(res, error);}
  });
  router.get("/orders/:id", cashier, (req, res) => {
    const order = db.prepare(`SELECT id,order_number AS orderNumber,status,
      service_type AS serviceType,customer_name AS customer,payment,
      payment_status AS paymentStatus,subtotal,voucher_discount AS voucherDiscount,
      total,cash_tendered AS cashTendered,cash_change AS cashChange,
      created_at AS createdAt FROM orders WHERE id=? AND order_type='In-store'`).get(req.params.id);
    if (!order) return res.status(404).json({message:"In-store order was not found."});
    res.json({order:{...order,items:items(order.id, true)}});
  });
  router.post("/orders/quote", cashier, (req, res) => {
    try {res.json(workflow.prepareQuote(req.body || {}, true));}
    catch (error) {sendError(res, error);}
  });
  router.post("/orders", cashier, (req, res) => {
    try {
      if (!["Cash", "GCash"].includes(req.body?.payment || "Cash")) {
        throw new OrderError("Choose Cash or GCash.");
      }
      res.status(201).json(workflow.create(req.body || {}, req.user, true));
    } catch (error) {sendError(res, error);}
  });

  router.get("/preparation", staff, (req, res) => {
    const orders = db.prepare(`SELECT o.id,o.order_number AS orderNumber,o.order_type AS orderType,
      o.service_type AS serviceType,o.status,o.payment,o.payment_status AS paymentStatus,
      o.payment_reference AS paymentReference,o.address,o.phone,o.total,
      o.delivery_revision AS deliveryRevision,o.rider_fee_cents / 100.0 AS riderFee,
      o.delivery_tracking_url AS trackingUrl,o.created_at AS createdAt,
      COALESCE(NULLIF(o.customer_name,''),u.first_name || ' ' || u.last_name) AS customer
      FROM orders o JOIN users u ON u.id=o.user_id
      WHERE o.status IN ('New','Preparing')
        OR (o.order_type='Online' AND o.status IN ('Out for Delivery','Arrived'))
      ORDER BY o.id`).all();
    res.json({orders:orders.map(order => ({...order,items:items(order.id)}))});
  });
  router.patch("/preparation/:id/status", staff, (req, res) => {
    try {
      const result = db.transaction(() => {
        const order = db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);
        if (!order) throw new OrderError("Order was not found.", 404);
        const next = order.order_type === "In-store" ? "Completed" : "Out for Delivery";
        const requested = req.body?.status;
        const completingDelivery = order.order_type === "Online" && requested === "Completed";
        const allowed = order.status === "New" ? requested === "Preparing"
          : (order.status === "Preparing" && requested === next)
            || (completingDelivery && ["Out for Delivery", "Arrived"].includes(order.status));
        // Permit a harmless repeat after a network retry, but no skipped stages.
        if (!allowed && !(requested === order.status && ["Preparing",next,"Completed"].includes(requested))) {
          throw new OrderError("Start preparation, hand the order to the rider, then confirm delivery before completing it.", 403);
        }
        if (completingDelivery && req.body?.deliveryConfirmed !== true) {
          throw new OrderError("Confirm that the rider delivered the complete order to the customer.", 400);
        }
        const saved = workflow.advance(order.id, requested, req.user, {deliveryConfirmed:req.body?.deliveryConfirmed === true});
        return {orderId:saved.orderId,orderNumber:saved.orderNumber,status:saved.status};
      }).immediate();
      res.json(result);
    } catch (error) {sendError(res, error);}
  });
  router.patch("/preparation/:id/verify-payment", staff, (req, res) => {
    try {res.json(paymentReview.verify(req.params.id, req.body || {}, req.user));}
    catch (error) {sendError(res, error);}
  });
  router.put("/preparation/:id/delivery", staff, (req, res) => {
    try {res.json({delivery:delivery.save(req.params.id, req.body || {}, req.user)});}
    catch (error) {sendError(res, error);}
  });
  router.get("/stock", staff, (req, res) => {
    const items = db.prepare(`SELECT * FROM inventory_items WHERE is_archived=0
      ORDER BY category,product_name`).all().map(item => ({
        id:item.id,productName:item.product_name,category:item.category,
        quantity:round(item.quantity),measurement:item.measurement,
        status:item.quantity<=0?"Out of Stock":item.quantity<=lowStockLevel(item)?"Low Stock":"In Stock"
      }));
    res.json({items});
  });
  return router;
};
