const {OrderError}=require("./pricing");
const {lowStockLevel}=require("./inventory");
const {catalog}=require("./pricing");
const dayMs=86400000;
const manilaDay=date=>new Date(date.getTime()+8*3600000).toISOString().slice(0,10);
const shift=(date,days)=>new Date(Date.parse(date+"T00:00:00Z")+days*dayMs).toISOString().slice(0,10);
function dateInput(value) {
  if (value===undefined||value==="") return "";
  if (typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value)||
      !Number.isFinite(Date.parse(value+"T00:00:00Z"))||new Date(value+"T00:00:00Z").toISOString().slice(0,10)!==value) {
    throw new OrderError("Use a valid date in YYYY-MM-DD format.");
  }
  return value;
}
function period(now,range="week") {
  const end=manilaDay(now);
  if (!["week","month"].includes(range)) throw new OrderError("Choose week or month.");
  const weekday=new Date(end+"T00:00:00Z").getUTCDay();
  return {start:range==="month"?end.slice(0,8)+"01":shift(end,-((weekday+6)%7)),end};
}
function createReports(db,clock=()=>new Date()) {
  const saleDate="DATE(completed_at, '+8 hours')";
  const settledDate="DATE(CASE WHEN o.status='Completed' THEN o.completed_at ELSE o.canceled_at END, '+8 hours')";
  function sales(from,to) {
    return db.prepare("SELECT ROUND(COALESCE(SUM(total),0),2) AS total FROM orders WHERE status='Completed' AND "+saleDate+" BETWEEN ? AND ?").get(from,to).total;
  }
  function summary() {
    const today=manilaDay(clock()),month=today.slice(0,8)+"01",yesterday=shift(today,-1);
    const previousMonthEnd=shift(month,-1),previousMonthStart=previousMonthEnd.slice(0,8)+"01";
    const stock=db.prepare("SELECT * FROM inventory_items WHERE is_archived=0").all();
    const counts=db.prepare(`SELECT COUNT(*) AS totalOrders,
      SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) AS completedOrders,
      SUM(CASE WHEN status='Canceled' THEN 1 ELSE 0 END) AS canceledOrders,
      SUM(CASE WHEN status='Completed' AND completed_at IS NULL THEN 1 ELSE 0 END) AS undatedCompletedOrders
      FROM orders`).get();
    const week=period(clock());
    return {...counts,completedOrders:counts.completedOrders||0,canceledOrders:counts.canceledOrders||0,
      todaySales:sales(today,today),yesterdaySales:sales(yesterday,yesterday),monthSales:sales(month,today),
      previousMonthSales:sales(previousMonthStart,previousMonthEnd),timezone:"Asia/Manila",
      totalTransactions:(counts.completedOrders||0)+(counts.canceledOrders||0),
      servedThisWeek:db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status='Completed' AND "+saleDate+" BETWEEN ? AND ?").get(week.start,week.end).n,
      totalCustomers:db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='Customer'").get().n,
      lowStockItems:stock.filter(item=>item.quantity>0&&item.quantity<=lowStockLevel(item)).length,
      outOfStockItems:stock.filter(item=>item.quantity<=0).length};
  }
  function dashboard(query={}) {
    const salesRange=period(clock(),query.salesRange||"week");
    const orderRange=period(clock(),query.orderRange||"week");
    const productRange=period(clock(),query.productRange||"week");
    const grouped=db.prepare("SELECT "+saleDate+" AS day,ROUND(SUM(total),2) AS total FROM orders WHERE status='Completed' AND "+saleDate+" BETWEEN ? AND ? GROUP BY day").all(salesRange.start,salesRange.end);
    const salesSeries=[];
    for (let day=salesRange.start;day<=salesRange.end;day=shift(day,1)) salesSeries.push({day,total:grouped.find(row=>row.day===day)?.total||0});
    const orderSummary=db.prepare(`SELECT CASE WHEN order_type='Online' THEN 'Online'
      WHEN service_type IN ('Takeout','Take out') THEN 'Takeout' ELSE 'Dine-in' END AS type,COUNT(*) AS count
      FROM orders WHERE status!='Canceled' AND DATE(created_at,'+8 hours') BETWEEN ? AND ? GROUP BY type`).all(orderRange.start,orderRange.end);
    const topProducts=db.prepare(`SELECT i.product_id AS productId,i.product_name AS name,SUM(i.quantity) AS sold,
      ROUND(SUM(i.quantity*i.price),2) AS grossSales FROM order_items i JOIN orders o ON o.id=i.order_id
      WHERE o.status='Completed' AND DATE(o.completed_at,'+8 hours') BETWEEN ? AND ?
      GROUP BY i.product_id,i.product_name ORDER BY sold DESC,grossSales DESC,i.product_id LIMIT 10`).all(productRange.start,productRange.end)
      .map(row=>({...row,category:catalog.products.find(product=>product.id===row.productId)?.category||"Archived product"}));
    const recentOrders=db.prepare(`SELECT order_number AS orderNumber,order_type AS orderType,status,total FROM orders ORDER BY id DESC LIMIT 5`).all();
    const lowStock=db.prepare("SELECT * FROM inventory_items WHERE is_archived=0 ORDER BY quantity/initial_quantity,product_name").all()
      .filter(item=>item.quantity<=lowStockLevel(item)).slice(0,5)
      .map(item=>({productName:item.product_name,quantity:item.quantity,measurement:item.measurement,status:item.quantity<=0?"Out of Stock":"Low Stock"}));
    return {...summary(),salesSeries,orderSummary,topProducts,recentOrders,lowStock,ranges:{salesRange,orderRange,productRange}};
  }
  function transactions(query={},exporting=false) {
    const from=dateInput(query.from),to=dateInput(query.to);
    if (from&&to&&from>to) throw new OrderError("Start date must be before end date.");
    const status=query.status||"All",type=query.type||"All",payment=query.payment||"All";
    if (!["All","Completed","Canceled"].includes(status)||!["All","Online","Dine-in","Takeout"].includes(type)||!["All","Cash","GCash","Other"].includes(payment)) throw new OrderError("Invalid transaction filter.");
    const search=typeof query.search==="string"?query.search.trim().toLowerCase():"";
    if (search.length>150) throw new OrderError("Search is too long.");
    const where=["o.status IN ('Completed','Canceled')"],params=[];
    if (from) {where.push(settledDate+">=?");params.push(from);}
    if (to) {where.push(settledDate+"<=?");params.push(to);}
    if (status!=="All") {where.push("o.status=?");params.push(status);}
    if (type==="Online") where.push("o.order_type='Online'");
    if (type==="Takeout") where.push("o.order_type='In-store' AND o.service_type IN ('Takeout','Take out')");
    if (type==="Dine-in") where.push("o.order_type='In-store' AND COALESCE(o.service_type,'Dine-in')='Dine-in'");
    if (payment==="Other") where.push("o.payment NOT IN ('Cash','GCash')");
    else if (payment!=="All") {where.push("o.payment=?");params.push(payment);}
    const customer="COALESCE(NULLIF(o.customer_name,''),u.first_name||' '||u.last_name)";
    if (search) {where.push("instr(lower(o.order_number||' '||"+customer+"||' '||o.payment||' TRX-'||o.id),?)>0");params.push(search);}
    const join=" FROM orders o JOIN users u ON u.id=o.user_id WHERE "+where.join(" AND ");
    const matched=db.prepare("SELECT COUNT(*) AS count,ROUND(COALESCE(SUM(CASE WHEN o.status='Completed' THEN o.total ELSE 0 END),0),2) AS sales"+join).get(...params);
    const requested=Number(query.page||1),pageSize=20;
    if (!Number.isSafeInteger(requested)||requested<1) throw new OrderError("Invalid page.");
    const pages=Math.max(1,Math.ceil(matched.count/pageSize)),page=Math.min(requested,pages);
    if (exporting&&matched.count>10000) throw new OrderError("Narrow the date range to export at most 10,000 transactions.");
    const transactions=db.prepare(`SELECT o.id,o.order_number AS orderNumber,o.order_type AS orderType,o.service_type AS serviceType,
      o.status,o.payment,o.payment_status AS paymentStatus,o.refund_status AS refundStatus,o.subtotal,o.delivery_fee AS deliveryFee,
      o.voucher_discount AS voucherDiscount,o.total,o.created_at AS createdAt,o.completed_at AS completedAt,o.canceled_at AS canceledAt,
      ${customer} AS customer,CASE WHEN o.order_type='In-store' THEN u.first_name||' '||u.last_name ELSE 'Online checkout' END AS cashier`
      +join+" ORDER BY COALESCE(o.completed_at,o.canceled_at,o.created_at) DESC,o.id DESC LIMIT ? OFFSET ?")
      .all(...params,exporting?10000:pageSize,exporting?0:(page-1)*pageSize);
    return {transactions,page,pages,pageSize,matched:matched.count,filteredSales:matched.sales,summary:summary(),timezone:"Asia/Manila"};
  }
  return {summary,dashboard,transactions};
}
function csv(rows) {
  const cell=value=>{
    let text=String(value??"");
    if (/^[\s]*[=+@-]/.test(text)) text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  };
  const headers=["Transaction ID","Settled at (UTC)","Type","Order ID","Customer","Payment","Total (PHP)","Status","Refund status","Cashier"];
  return "\uFEFF"+[headers,...rows.map(row=>["TRX-"+row.id,row.completedAt||row.canceledAt||"",row.serviceType||row.orderType,row.orderNumber,row.customer,row.payment,Number(row.total).toFixed(2),row.status,row.refundStatus,row.cashier])]
    .map(row=>row.map(cell).join(",")).join("\r\n");
}
module.exports={createReports,manilaDay,period,dateInput,csv};
