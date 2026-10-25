const {OrderError}=require("./pricing");
const {stockLevels}=require("./inventory");
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
    const stock=stockLevels(db,clock());
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
      lowStockItems:stock.filter(row=>row.level.status==="Low Stock").length,
      outOfStockItems:stock.filter(row=>row.level.status==="Out of Stock").length};
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
    const lowStock=stockLevels(db,clock()).filter(row=>row.level.status!=="In Stock")
      .sort((a,b)=>a.item.quantity/(a.level.reorderLevel||1)-b.item.quantity/(b.level.reorderLevel||1)||a.item.product_name.localeCompare(b.item.product_name))
      .slice(0,5).map(({item,level})=>({productName:item.product_name,quantity:item.quantity,measurement:item.measurement,
        reorderLevel:level.reorderLevel,daysLeft:level.daysLeft,status:level.status}));
    return {...summary(),salesSeries,orderSummary,topProducts,recentOrders,lowStock,ranges:{salesRange,orderRange,productRange}};
  }
  function transactions(query={},exporting=false) {
    const from=dateInput(query.from),to=dateInput(query.to);
    if (from&&to&&from>to) throw new OrderError("Start date must be before end date.");
    const status=query.status||"All",type=query.type||"All",payment=query.payment||"All";
    if (!["All","Completed","Canceled"].includes(status)||!["All","Online","Delivery","Pickup","Dine-in","Takeout"].includes(type)||!["All","Cash","GCash","Other"].includes(payment)) throw new OrderError("Invalid transaction filter.");
    const search=typeof query.search==="string"?query.search.trim().toLowerCase():"";
    if (search.length>150) throw new OrderError("Search is too long.");
    const where=["o.status IN ('Completed','Canceled')"],params=[];
    if (from) {where.push(settledDate+">=?");params.push(from);}
    if (to) {where.push(settledDate+"<=?");params.push(to);}
    if (status!=="All") {where.push("o.status=?");params.push(status);}
    if (type==="Online") where.push("o.order_type='Online'");
    if (type==="Delivery") where.push("o.order_type='Online' AND COALESCE(o.service_type,'Delivery')<>'Pickup'");
    if (type==="Pickup") where.push("o.order_type='Online' AND o.service_type='Pickup'");
    if (type==="Takeout") where.push("o.order_type='In-store' AND o.service_type IN ('Takeout','Take out')");
    if (type==="Dine-in") where.push("o.order_type='In-store' AND COALESCE(o.service_type,'Dine-in')='Dine-in'");
    if (payment==="Other") where.push("o.payment NOT IN ('Cash','GCash')");
    else if (payment!=="All") {where.push("o.payment=?");params.push(payment);}
    const customer="COALESCE(NULLIF(o.customer_name,''),u.first_name||' '||u.last_name)";
    if (search) {where.push("instr(lower(o.order_number||' '||"+customer+"||' '||o.payment||' TRX-'||o.id),?)>0");params.push(search);}
    const join=" FROM orders o JOIN users u ON u.id=o.user_id WHERE "+where.join(" AND ");
    const matched=db.prepare("SELECT COUNT(*) AS count,SUM(CASE WHEN o.status='Completed' THEN 1 ELSE 0 END) AS completed,ROUND(COALESCE(SUM(CASE WHEN o.status='Completed' THEN o.total ELSE 0 END),0),2) AS sales"+join).get(...params);
    const requested=Number(query.page||1),pageSize=20;
    if (!Number.isSafeInteger(requested)||requested<1) throw new OrderError("Invalid page.");
    const pages=Math.max(1,Math.ceil(matched.count/pageSize)),page=Math.min(requested,pages);
    if (exporting&&matched.count>10000) throw new OrderError("Narrow the date range to export at most 10,000 transactions.");
    const transactions=db.prepare(`SELECT o.id,o.order_number AS orderNumber,o.order_type AS orderType,o.service_type AS serviceType,
      o.status,o.payment,o.payment_status AS paymentStatus,o.refund_status AS refundStatus,o.subtotal,o.delivery_fee AS deliveryFee,
      o.voucher_discount AS voucherDiscount,o.special_discount AS specialDiscount,o.vat_exempt AS vatExempt,
      o.special_discount_type AS specialDiscountType,o.special_discount_id AS specialDiscountId,o.total,o.created_at AS createdAt,o.completed_at AS completedAt,o.canceled_at AS canceledAt,
      o.cash_tendered AS cashTendered,o.cash_change AS cashChange,
      (SELECT group_concat(i.product_name||' x'||i.quantity,', ') FROM order_items i WHERE i.order_id=o.id) AS items,
      ${customer} AS customer,CASE WHEN o.order_type='In-store' THEN u.first_name||' '||u.last_name ELSE 'Online checkout' END AS cashier`
      +join+" ORDER BY COALESCE(o.completed_at,o.canceled_at,o.created_at) DESC,o.id DESC LIMIT ? OFFSET ?")
      .all(...params,exporting?10000:pageSize,exporting?0:(page-1)*pageSize);
    // Totals for the cards above the table: every matching transaction, but only completed orders count as money.
    const completed=matched.completed||0;
    const totals={transactions:matched.count,completed,canceled:matched.count-completed,amount:matched.sales,
      averageOrder:completed?Math.round(matched.sales/completed*100)/100:0};
    return {transactions,page,pages,pageSize,matched:matched.count,filteredSales:matched.sales,totals,summary:summary(),timezone:"Asia/Manila"};
  }
  // Sales summary for one Philippine day or one calendar month, including
  // earlier months (panel feedback). Sales count when an order is completed.
  function salesSummary(query={}) {
    const today=manilaDay(clock());
    const kind=query.period||"day";
    if (!["day","week","month","year"].includes(kind)) throw new OrderError("Choose a daily, weekly, monthly or yearly summary.");
    let start,end,previous;
    if (kind==="day") {
      start=end=dateInput(query.date)||today;
      previous={start:shift(start,-1),end:shift(start,-1)};
    } else if (kind==="week") {
      // Monday to Sunday week containing the chosen day.
      const day=dateInput(query.date)||today;
      start=shift(day,-((new Date(day+"T00:00:00Z").getUTCDay()+6)%7));
      end=shift(start,6);
      previous={start:shift(start,-7),end:shift(start,-1)};
    } else if (kind==="year") {
      const year=String(query.year||today.slice(0,4));
      if (!/^\d{4}$/.test(year)||Number(year)<2000) throw new OrderError("Use a valid year, such as 2026.");
      start=year+"-01-01";end=year+"-12-31";
      previous={start:(Number(year)-1)+"-01-01",end:(Number(year)-1)+"-12-31"};
    } else {
      const month=query.month||today.slice(0,7);
      if (typeof month!=="string"||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new OrderError("Use a valid month in YYYY-MM format.");
      start=month+"-01";
      const next=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1));
      end=shift(next.toISOString().slice(0,10),-1);
      const prevEnd=shift(start,-1);
      previous={start:prevEnd.slice(0,8)+"01",end:prevEnd};
    }
    if (start>today) throw new OrderError("Choose today or an earlier date.");
    const through=end>today?today:end;
    const completed="o.status='Completed' AND DATE(o.completed_at,'+8 hours') BETWEEN ? AND ?";
    const totals=(from,to)=>db.prepare(`SELECT COUNT(*) AS orders,
      ROUND(COALESCE(SUM(o.subtotal),0),2) AS grossSales,
      ROUND(COALESCE(SUM(o.voucher_discount),0),2) AS voucherDiscounts,
      ROUND(COALESCE(SUM(o.special_discount),0),2) AS specialDiscounts,
      ROUND(COALESCE(SUM(o.vat_exempt),0),2) AS vatExempt,
      ROUND(COALESCE(SUM(o.total),0),2) AS netSales,
      SUM(CASE WHEN o.special_discount_type='Senior Citizen' AND COALESCE(o.special_discount_status,'')<>'Not approved' THEN 1 ELSE 0 END) AS seniorOrders,
      SUM(CASE WHEN o.special_discount_type='PWD' AND COALESCE(o.special_discount_status,'')<>'Not approved' THEN 1 ELSE 0 END) AS pwdOrders
      FROM orders o WHERE ${completed}`).get(from,to);
    const current=totals(start,through), before=totals(previous.start,previous.end);
    const canceled=db.prepare("SELECT COUNT(*) AS n, ROUND(COALESCE(SUM(total),0),2) AS value FROM orders WHERE status='Canceled' AND DATE(canceled_at,'+8 hours') BETWEEN ? AND ?").get(start,through);
    const byPayment=db.prepare(`SELECT o.payment,COUNT(*) AS orders,ROUND(SUM(o.total),2) AS total FROM orders o WHERE ${completed}
      GROUP BY o.payment ORDER BY total DESC`).all(start,through);
    const byType=db.prepare(`SELECT CASE WHEN o.order_type='Online' AND o.service_type='Pickup' THEN 'Online pickup'
      WHEN o.order_type='Online' THEN 'Online delivery'
      WHEN o.service_type IN ('Takeout','Take out') THEN 'Takeout' ELSE 'Dine-in' END AS type,
      COUNT(*) AS orders,ROUND(SUM(o.total),2) AS total FROM orders o WHERE ${completed} GROUP BY type ORDER BY total DESC`).all(start,through);
    const topItems=db.prepare(`SELECT i.product_name AS name,SUM(i.quantity) AS quantity,ROUND(SUM(i.quantity*i.price),2) AS sales
      FROM order_items i JOIN orders o ON o.id=i.order_id WHERE ${completed}
      GROUP BY i.product_id,i.product_name ORDER BY quantity DESC,sales DESC LIMIT 5`).all(start,through);
    const bucket=kind==="day"?"CAST(strftime('%H',o.completed_at,'+8 hours') AS INTEGER)"
      :kind==="year"?"strftime('%Y-%m',o.completed_at,'+8 hours')":"DATE(o.completed_at,'+8 hours')";
    const grouped=db.prepare(`SELECT ${bucket} AS bucket,COUNT(*) AS orders,ROUND(SUM(o.total),2) AS total FROM orders o
      WHERE ${completed} GROUP BY bucket`).all(start,through);
    const series=[];
    if (kind==="day") for (let hour=0;hour<24;hour++) {
      const row=grouped.find(entry=>entry.bucket===hour);
      series.push({label:String(hour).padStart(2,"0")+":00",orders:row?.orders||0,total:row?.total||0});
    } else if (kind==="year") for (let month=1;month<=12;month++) {
      const key=start.slice(0,5)+String(month).padStart(2,"0");
      const row=grouped.find(entry=>entry.bucket===key);
      series.push({label:key,orders:row?.orders||0,total:row?.total||0});
    } else for (let day=start;day<=end;day=shift(day,1)) {
      const row=grouped.find(entry=>entry.bucket===day);
      series.push({label:day,orders:row?.orders||0,total:row?.total||0});
    }
    const change=(now,then)=>then?Math.round((now-then)/then*1000)/10:null;
    return {period:kind,start,end,through,timezone:"Asia/Manila",
      ...current,seniorOrders:current.seniorOrders||0,pwdOrders:current.pwdOrders||0,
      averageOrder:current.orders?Math.round(current.netSales/current.orders*100)/100:0,
      canceledOrders:canceled.n,canceledValue:canceled.value,transactions:current.orders+canceled.n,
      previous:{start:previous.start,end:previous.end,orders:before.orders,netSales:before.netSales,
        change:change(current.netSales,before.netSales)},
      byPayment,byType,topItems,series};
  }
  return {summary,dashboard,transactions,salesSummary};
}
function csv(rows) {
  const cell=value=>{
    let text=String(value??"");
    if (/^[\s]*[=+@-]/.test(text)) text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  };
  const headers=["Transaction ID","Settled at (UTC)","Type","Order ID","Customer","Payment","Subtotal (PHP)","Voucher (PHP)","SC/PWD discount (PHP)","VAT exempt (PHP)","SC/PWD type","SC/PWD ID","Total (PHP)","Status","Refund status","Cashier"];
  return "\uFEFF"+[headers,...rows.map(row=>["TRX-"+row.id,row.completedAt||row.canceledAt||"",row.serviceType||row.orderType,row.orderNumber,row.customer,row.payment,
    Number(row.subtotal||0).toFixed(2),Number(row.voucherDiscount||0).toFixed(2),Number(row.specialDiscount||0).toFixed(2),Number(row.vatExempt||0).toFixed(2),
    row.specialDiscountType||"",row.specialDiscountId||"",Number(row.total).toFixed(2),row.status,row.refundStatus,row.cashier])]
    .map(row=>row.map(cell).join(",")).join("\r\n");
}
// Spreadsheet-ready transaction report: a summary block, then every transaction with its items and change.
function reportCsv(data, label) {
  const cell=value=>{
    let text=String(value??"");
    if (/^[\s]*[=+@-]/.test(text)) text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  };
  const peso=value=>Number(value||0).toFixed(2);
  const settled=row=>{
    const value=row.completedAt||row.canceledAt;
    return value?new Date(value.replace(" ","T")+"Z").toLocaleString("en-PH",{timeZone:"Asia/Manila",dateStyle:"medium",timeStyle:"short"}):"";
  };
  const rows=[
    ["Kopi; Calamba transaction report"],["Interval",label||"All time"],["Timezone","Asia/Manila"],[],
    ["Total transactions",data.totals.transactions],["Completed orders",data.totals.completed],["Canceled orders",data.totals.canceled],
    ["Total amount (PHP, completed orders)",peso(data.totals.amount)],["Average order (PHP)",peso(data.totals.averageOrder)],[],
    ["Order ID","Transaction ID","Date & time","Cashier","Customer","Type","Items","Payment","Total (PHP)","Cash received (PHP)","Change (PHP)","Status"],
    ...data.transactions.map(row=>[row.orderNumber,"TRX-"+row.id,settled(row),row.cashier,row.customer,row.serviceType||row.orderType,row.items||"",
      row.payment,peso(row.total),row.cashTendered==null?"":peso(row.cashTendered),row.cashChange==null?"":peso(row.cashChange),row.status])
  ];
  return "﻿"+rows.map(row=>row.map(cell).join(",")).join("\r\n");
}
function summaryCsv(data) {
  const cell=value=>{
    let text=String(value??"");
    if (/^[\s]*[=+@-]/.test(text)) text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  };
  const peso=value=>Number(value||0).toFixed(2);
  const rows=[
    ["Kopi; Calamba sales summary"],["Period",{day:"Daily",week:"Weekly",month:"Monthly",year:"Yearly"}[data.period]],["From",data.start],["To",data.through],["Timezone",data.timezone],[],
    ["Completed orders",data.orders],["Total transactions (completed + canceled)",data.transactions],["Gross sales (PHP)",peso(data.grossSales)],["Voucher discounts (PHP)",peso(data.voucherDiscounts)],
    ["Senior Citizen/PWD 20% discounts (PHP)",peso(data.specialDiscounts)],["VAT exemption (PHP)",peso(data.vatExempt)],
    ["Net sales (PHP)",peso(data.netSales)],["Average order (PHP)",peso(data.averageOrder)],
    ["Senior Citizen orders",data.seniorOrders],["PWD orders",data.pwdOrders],["Canceled orders",data.canceledOrders],
    ["Previous period net sales (PHP)",peso(data.previous.netSales)],[],
    ["Payment","Orders","Net sales (PHP)"],...data.byPayment.map(row=>[row.payment,row.orders,peso(row.total)]),[],
    ["Order type","Orders","Net sales (PHP)"],...data.byType.map(row=>[row.type,row.orders,peso(row.total)]),[],
    ["Top item","Quantity","Item sales (PHP)"],...data.topItems.map(row=>[row.name,row.quantity,peso(row.sales)]),[],
    [{day:"Hour",week:"Date",month:"Date",year:"Month"}[data.period],"Orders","Net sales (PHP)"],...data.series.map(row=>[row.label,row.orders,peso(row.total)])
  ];
  return "\uFEFF"+rows.map(row=>row.map(cell).join(",")).join("\r\n");
}
module.exports={createReports,manilaDay,period,dateInput,csv,reportCsv,summaryCsv};
