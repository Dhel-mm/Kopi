const {OrderError, money} = require("./pricing");
const info = require("../../Customer/DeliveryInfo");

function createDeliveryService(db) {
  function read(id) {
    const row = db.prepare(`SELECT id AS orderId,order_number AS orderNumber,payment,total,
      rider_fee_cents / 100.0 AS riderFee,delivery_tracking_url AS trackingUrl,
      delivery_message AS message,delivery_revision AS revision,
      delivery_sent_at AS sentAt,delivery_acknowledged_at AS acknowledgedAt
      FROM orders WHERE id=?`).get(id);
    // Render older saved notifications with the current wording too.
    if (row?.revision) row.message = info.message(row.riderFee, row.trackingUrl, row.payment, row.total);
    return row;
  }

  const save = db.transaction((id, input, user) => {
    if (!["Admin", "Staff"].includes(user.role)) {
      throw new OrderError("Administrator or staff access is required.", 403);
    }
    const row = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
    if (!row) throw new OrderError("Order was not found.", 404);
    if (row.order_type !== "Online" || !["Preparing", "Out for Delivery", "Arrived"].includes(row.status)) {
      throw new OrderError("Delivery details can only be sent for an online order being prepared or delivered.", 409);
    }
    if (row.payment === "GCash" && row.payment_status !== "Verified") {
      throw new OrderError("Verify the GCash payment before sending delivery details.", 409);
    }
    const fee = money(input.fee, "Delivery fee");
    const link = info.trackingUrl(input.trackingUrl);
    if (!link) throw new OrderError("Paste a valid HTTPS Lalamove live tracking/share link.");
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) {
      throw new OrderError("Refresh the order before sending delivery details.");
    }
    // An identical retry must not generate a second notification or clear an acknowledgement.
    if (row.rider_fee_cents === fee && row.delivery_tracking_url === link) return read(id);
    if (row.delivery_revision !== input.revision) {
      throw new OrderError("Delivery details changed. Close this dialog and reopen the order to review them.", 409);
    }
    db.prepare(`UPDATE orders SET rider_fee_cents=?,delivery_tracking_url=?,delivery_message=?,
      delivery_revision=delivery_revision+1,delivery_sent_at=CURRENT_TIMESTAMP,
      delivery_sent_by=?,delivery_acknowledged_at=NULL WHERE id=?`)
      .run(fee, link, info.message(fee / 100, link, row.payment, row.total), user.id, id);
    return read(id);
  });

  function pending(user) {
    return db.prepare(`SELECT id FROM orders WHERE user_id=? AND order_type='Online'
      AND delivery_revision>0 AND delivery_acknowledged_at IS NULL AND status!='Canceled'
      ORDER BY delivery_sent_at,id LIMIT 100`).all(user.id).map(row => read(row.id));
  }

  const acknowledge = db.transaction((id, revision, user) => {
    const row = db.prepare("SELECT * FROM orders WHERE id=? AND user_id=? AND order_type='Online'").get(id, user.id);
    if (!row || !row.delivery_revision) throw new OrderError("Delivery notification was not found.", 404);
    if (!Number.isSafeInteger(revision) || row.delivery_revision !== revision) {
      throw new OrderError("Delivery details were updated. Please review the latest notification.", 409);
    }
    db.prepare(`UPDATE orders SET delivery_acknowledged_at=COALESCE(delivery_acknowledged_at,CURRENT_TIMESTAMP)
      WHERE id=? AND user_id=?`).run(id, user.id);
    return read(id);
  });

  return {read, pending, save: (...args) => save.immediate(...args), acknowledge: (...args) => acknowledge.immediate(...args)};
}
module.exports = {createDeliveryService};
