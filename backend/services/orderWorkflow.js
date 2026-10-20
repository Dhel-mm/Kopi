const { createHash } = require("node:crypto");
const { quote, money, OrderError } = require("./pricing");
const { createInventoryService } = require("./inventory");
const { parseManualPayment } = require("./manualPayment");
const { createVoucherService } = require("./vouchers");

function text(value, label, max, optional = false) {
  if (optional && (value == null || value === "")) return "";
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new OrderError(`Enter a valid ${label} (up to ${max} characters).`);
  }
  return value.trim();
}

// Hash the requested choices, not current menu prices. A retry after a price
// update must still return the order that already succeeded.
function requestFingerprint(body, inStore) {
  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
    }
    return value;
  }
  const intent = {
    inStore,
    items: Array.isArray(body.items) ? body.items.map(item=>({
      productId:item?.productId,quantity:item?.quantity,options:item?.options ?? {}
    })) : body.items,
    payment:body.payment ?? "Cash",paymentReference:body.paymentReference ?? "",
    serviceType:inStore?body.serviceType:"Delivery",
    address:inStore?"":body.address,phone:inStore?"":body.phone,
    customerName:inStore?(body.customerName||"Walk-in Customer"):"",
    voucher:body.voucher||"",discount:inStore?(body.discount??0):0,
    expectedTotal:body.expectedTotal,confirmedReceived:inStore?body.confirmedReceived:null,
    cashTendered:inStore?body.cashTendered:null
  };
  return "v2:"+createHash("sha256").update(JSON.stringify(stable(intent))).digest("hex");
}
function createOrderWorkflow(db) {
  const stock = createInventoryService(db);
  const vouchers = createVoucherService(db);

  // Called inside the immediate creation transaction, so simultaneous checkouts
  // cannot allocate the same number. Keep historical order numbers untouched.
  function nextOrderNumber(inStore) {
    const prefix = inStore ? "POS-" : "KOPI-";
    const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'orders'").get();
    let number = (sequence?.seq || 0) + 1;
    let candidate;
    do {
      candidate = prefix + String(number++).padStart(4, "0");
    } while (db.prepare("SELECT 1 FROM orders WHERE order_number = ?").get(candidate));
    return candidate;
  }
  function service(body, inStore) {
    if (!inStore) return "Delivery";
    const type = body.serviceType === "Take out" ? "Takeout" : body.serviceType;
    if (!["Dine-in","Takeout"].includes(type)) throw new OrderError("Choose Dine-in or Takeout.");
    return type;
  }
  function prepareQuote(body, inStore = false) {
    const priced = quote(body,inStore,vouchers.resolve);
    const serviceType = service(body,inStore);
    stock.check(priced.items,serviceType!=="Dine-in");
    return { ...priced,serviceType };
  }
  function result(id) {
    const row = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
    return {
      orderId:row.id,orderNumber:row.order_number,status:row.status,payment:row.payment,createdAt:row.created_at,
      paymentStatus:row.payment_status,paymentReference:row.payment_reference,
      inventoryState:row.inventory_state,refundStatus:row.refund_status,
      subtotal:row.subtotal,deliveryFee:row.delivery_fee,voucher:row.voucher,voucherDiscount:row.voucher_discount,total:row.total,
      cashTendered:row.cash_tendered,cashChange:row.cash_change,
      items:db.prepare("SELECT product_id AS productId,product_name AS name,quantity,price,options_json FROM order_items WHERE order_id=?").all(id)
        .map(item=>({productId:item.productId,name:item.name,quantity:item.quantity,price:item.price,options:JSON.parse(item.options_json)}))
    };
  }
  function create(body, user, inStore = false) {
    const requestKey = text(body.requestKey,"checkout request key",100);
    if (!/^[a-zA-Z0-9-]{16,100}$/.test(requestKey)) throw new OrderError("Invalid checkout request key. Refresh the page.");
    const intentHash = requestFingerprint(body,inStore);
    const previous = db.prepare("SELECT id,request_hash FROM orders WHERE user_id=? AND request_key=?").get(user.id,requestKey);
    if (previous?.request_hash?.startsWith("v2:")) {
      if (previous.request_hash!==intentHash) throw new OrderError("This checkout request was already used for a different order.",409);
      return result(previous.id);
    }
    const serviceType = service(body,inStore);
    let priced = quote(body,inStore,vouchers.resolve);
    const paymentName = body.payment === "gCash" ? "GCash" : (body.payment ?? "Cash");
    let payment;
    if (inStore && !["Cash","GCash"].includes(paymentName)) {
      payment = {payment:text(paymentName,"payment method",50),reference:null,status:"Unpaid"};
    } else {
      try { payment = parseManualPayment(paymentName,body.paymentReference); }
      catch (error) { throw new OrderError(error.message); }
    }
    if (inStore && payment.payment==="GCash") {
      if (body.confirmedReceived!==true) throw new OrderError("Check GCash receipt in the shop account before placing this in-store order.");
      payment.status="Verified";
    }
    let cashTendered = null;
    let cashChange = null;
    if (inStore && payment.payment === "Cash") {
      const tenderedCents = money(body.cashTendered, "Cash received");
      const totalCents = money(priced.total, "Order total");
      if (tenderedCents < totalCents) throw new OrderError("Cash received must cover the order total.");
      cashTendered = tenderedCents / 100;
      cashChange = (tenderedCents - totalCents) / 100;
      payment.status = "Paid";
    }
    const address = inStore?"":text(body.address,"delivery address",500);
    const phone = inStore?"":text(body.phone,"phone number",11);
    if (!inStore && !/^09[0-9]{9}$/.test(phone)) throw new OrderError("Enter an 11-digit phone number beginning with 09.");
    const customerName = inStore?text(body.customerName||"Walk-in Customer","customer name",120):"";
    const payload = {items:priced.items.map(({cartId,image,...item})=>item),payment,serviceType,address,phone,customerName,voucher:priced.voucher,total:priced.total,inStore};
    const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    return db.transaction(() => {
      const existing = db.prepare("SELECT id,request_hash FROM orders WHERE user_id=? AND request_key=?").get(user.id,requestKey);
      if (existing) {
        const expectedHash = existing.request_hash?.startsWith("v2:") ? intentHash : fingerprint;
        if (existing.request_hash!==expectedHash) throw new OrderError("This checkout request was already used for a different order.",409);
        return result(existing.id);
      }
      // Recheck the current voucher inside the write transaction before charging.
      priced = quote(body,inStore,vouchers.resolve);
      if (body.expectedTotal == null || money(body.expectedTotal)!==money(priced.total)) {
        throw new OrderError("The order total changed. Review the updated price before placing the order.",409);
      }
      stock.check(priced.items,serviceType!=="Dine-in");
      const status = inStore?"Preparing":"New";
      const orderNumber = nextOrderNumber(inStore);
      const inserted = db.prepare(`
        INSERT INTO orders (
          order_number,user_id,customer_name,order_type,service_type,status,payment,address,phone,voucher,
          subtotal,delivery_fee,voucher_discount,total,payment_reference,payment_status,
          payment_verified_at,payment_verified_by,inventory_state,request_key,request_hash,cash_tendered,cash_change
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(orderNumber,user.id,customerName,inStore?"In-store":"Online",serviceType,status,payment.payment,
        address,phone,priced.voucher,priced.subtotal,priced.deliveryFee,priced.voucherDiscount,priced.total,
        payment.reference,payment.status,payment.status==="Verified"?new Date().toISOString():null,
        payment.status==="Verified"?user.id:null,inStore?"consumed":"reserved",requestKey,intentHash,cashTendered,cashChange);
      const id = inserted.lastInsertRowid;
      for (const item of priced.items) db.prepare("INSERT INTO order_items(order_id,product_id,product_name,quantity,price,options_json) VALUES(?,?,?,?,?,?)")
        .run(id,item.productId,item.name,item.quantity,item.price,JSON.stringify(item.options));
      vouchers.redeem(priced.voucher,id,user.id);
      stock.deduct(priced.items,id,serviceType!=="Dine-in");
      return result(id);
    }).immediate();
  }
  function recover(requestKey,user,inStore=false) {
    const order = db.prepare("SELECT id FROM orders WHERE user_id=? AND request_key=? AND order_type=?")
      .get(user.id,requestKey,inStore?"In-store":"Online");
    if (!order) throw new OrderError("No saved order was found for this checkout request.",404);
    return result(order.id);
  }
  function cancel(id, user) {
    return db.transaction(() => {
      const order = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
      if (!order || (user.role!=="Admin" && order.user_id!==user.id)) throw new OrderError("Order was not found.",404);
      if (order.status==="Canceled") return result(id);
      if (!["New","Preparing"].includes(order.status)) throw new OrderError("Only new or preparing orders can be canceled.",409);
      // Once staff start preparing, ingredients are used. Only an administrator
      // may cancel then (for example, after the customer calls the shop).
      if (user.role!=="Admin" && order.status!=="New") {
        throw new OrderError("This order is already being prepared and can no longer be canceled online. Please contact the shop.",409);
      }
      const canRestore = order.status==="New" && order.inventory_state!=="consumed";
      if (canRestore) stock.restore(id);
      // Give a one-time voucher back so the customer can use it on a new order.
      vouchers.release(id);
      db.prepare(`UPDATE orders SET status='Canceled',canceled_at=CURRENT_TIMESTAMP,inventory_state=?,
        refund_status=CASE WHEN payment='GCash' THEN 'Needs staff review' ELSE 'Not required' END WHERE id=?`)
        .run(canRestore?"returned":"consumed",id);
      return result(id);
    }).immediate();
  }
  function advance(id, next, user, {deliveryConfirmed = false} = {}) {
    if (next==="Canceled") return cancel(id,user);
    return db.transaction(() => {
      const order = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
      if (!order) throw new OrderError("Order was not found.",404);
      if (order.status===next) return result(id);
      const flow = order.order_type==="In-store"?["Preparing","Completed"]:["New","Preparing","Out for Delivery","Arrived","Completed"];
      const delivered = deliveryConfirmed && ["Admin", "Staff"].includes(user.role)
        && order.order_type === "Online" && order.status === "Out for Delivery" && next === "Completed";
      if (!delivered && (flow.indexOf(order.status)<0 || flow[flow.indexOf(order.status)+1]!==next)) throw new OrderError("Invalid order status transition.",409);
      if (order.payment==="GCash" && order.payment_status!=="Verified") throw new OrderError("Verify the GCash payment first.",409);
      db.prepare(`UPDATE orders SET status=?,inventory_state='consumed',
        payment_status=CASE WHEN ?='Completed' AND payment='Cash' THEN 'Paid' ELSE payment_status END,
        completed_at=CASE WHEN ?='Completed' THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id=?`).run(next,next,next,id);
      return result(id);
    }).immediate();
  }
  return {prepareQuote,create,cancel,advance,result,recover};
}
function sendError(response,error,customerFacing = false) {
  if (error.code==="SQLITE_CONSTRAINT_UNIQUE" && error.message.includes("payment_reference")) {
    return response.status(409).json({message:"That GCash reference is already attached to an order. Check My Orders before paying again."});
  }
  if (error instanceof OrderError) return response.status(error.status).json({message:customerFacing && error.customerMessage ? error.customerMessage : error.message});
  console.error("Order request failed:",error.code||error.name);
  return response.status(500).json({message:"Could not save the order. Please retry the same checkout request."});
}
module.exports = {createOrderWorkflow,sendError};
