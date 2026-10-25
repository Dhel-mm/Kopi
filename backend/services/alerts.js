// What the Staff and Admin pages should pop up (with a sound) about.
// Staff: online orders that have just arrived. Admin: orders waiting for a
// GCash payment or a Senior Citizen / PWD ID to be verified.
function createAlertService(db) {
  function staff() {
    const orders = db.prepare(`
      SELECT o.id,o.order_number AS orderNumber,o.service_type AS serviceType,o.scheduled_for AS scheduledFor,
        o.payment,o.total,o.created_at AS createdAt,
        COALESCE(NULLIF(o.customer_name,''),u.first_name || ' ' || u.last_name) AS customer
      FROM orders o JOIN users u ON u.id=o.user_id
      WHERE o.order_type='Online' AND o.status='New'
      ORDER BY o.id LIMIT 50
    `).all();
    return {orders};
  }
  function admin() {
    const orders = db.prepare(`
      SELECT o.id,o.order_number AS orderNumber,o.service_type AS serviceType,o.payment,o.total,o.created_at AS createdAt,
        o.special_discount_type AS specialDiscountType,
        (o.payment='GCash' AND o.payment_status='Pending verification') AS needsPayment,
        (o.special_discount_status='Pending verification') AS needsId,
        COALESCE(NULLIF(o.customer_name,''),u.first_name || ' ' || u.last_name) AS customer
      FROM orders o JOIN users u ON u.id=o.user_id
      WHERE o.order_type='Online' AND o.status IN ('New','Preparing')
        AND ((o.payment='GCash' AND o.payment_status='Pending verification') OR o.special_discount_status='Pending verification')
      ORDER BY o.id LIMIT 50
    `).all();
    return {orders: orders.map(({needsPayment, needsId, ...order}) => ({
      ...order,
      needs: [...(needsPayment ? ["GCash payment"] : []), ...(needsId ? [`${order.specialDiscountType || "Senior Citizen / PWD"} ID`] : [])]
    }))};
  }
  return {staff, admin};
}

module.exports = {createAlertService};
