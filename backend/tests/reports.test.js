const {test}=require("node:test");
const assert=require("node:assert/strict");
const {fixture}=require("./fixtures");
const {createReports,csv,dateInput}=require("../services/reports");
function record(db,{id,total=100,status="Completed",created="2026-09-28 10:00:00",settled="2026-10-01 01:00:00",type="Online",service="Delivery",name=""}) {
  db.prepare(`INSERT INTO orders(id,order_number,user_id,order_type,service_type,status,customer_name,total,subtotal,created_at,completed_at,canceled_at)
    VALUES(?,?,1,?,?,?,?,?,?,?, ?,?)`).run(id,"REPORT-"+id,type,service,status,name,total,total,created,status==="Completed"?settled:null,status==="Canceled"?settled:null);
  db.prepare("INSERT INTO order_items(order_id,product_id,product_name,quantity,price) VALUES(?,'cafe-latte','Cafe Latte',1,?)").run(id,total);
}
test("reports use completion dates in Philippine time and exclude cancellations from sales",()=>{
  const db=fixture(),reports=createReports(db,()=>new Date("2026-10-01T02:00:00Z"));
  try {
    record(db,{id:1,total:100,settled:"2026-09-30 15:59:59"});
    record(db,{id:2,total:200,settled:"2026-09-30 16:00:00",type:"In-store",service:"Takeout"});
    record(db,{id:3,total:300});
    record(db,{id:4,total:900,status:"Canceled"});
    record(db,{id:5,total:500,status:"New"});
    record(db,{id:6,total:50,settled:"2026-08-01 01:00:00"});
    const summary=reports.summary();
    assert.equal(summary.todaySales,500);
    assert.equal(summary.monthSales,500);
    assert.equal(summary.yesterdaySales,100);
    assert.equal(summary.previousMonthSales,100);
    assert.equal(summary.totalTransactions,5);
    const data=reports.dashboard({salesRange:"month",productRange:"month"});
    assert.deepEqual(data.salesSeries,[{day:"2026-10-01",total:500}]);
    assert.equal(data.topProducts[0].sold,2);
    assert.equal(data.topProducts[0].grossSales,500);
    assert.equal(data.orderSummary.find(row=>row.type==="Takeout").count,1);
    const filtered=reports.transactions({from:"2026-10-01",to:"2026-10-01"});
    assert.equal(filtered.matched,3);
    assert.equal(filtered.filteredSales,500);
    assert.equal(reports.transactions({type:"Takeout"}).matched,1);
    assert.equal(reports.transactions({status:"Canceled"}).filteredSales,0);
    assert.equal(reports.transactions({search:"REPORT-2"}).matched,1);
  }finally{db.close();}
});
test("date filters, pagination, undated history and CSV export are explicit and safe",()=>{
  const db=fixture(),reports=createReports(db,()=>new Date("2026-10-01T02:00:00Z"));
  try {
    for(let id=1;id<=25;id++)record(db,{id,name:id===1?"=HYPERLINK(\"malicious\")":"Customer"});
    record(db,{id:26,settled:null});
    assert.equal(reports.transactions({page:2}).transactions.length,6);
    assert.equal(reports.transactions({page:999}).page,2);
    assert.equal(reports.summary().undatedCompletedOrders,1);
    assert.equal(reports.transactions({from:"2026-10-01"}).matched,25);
    assert.throws(()=>dateInput("2026-02-30"),/valid date/);
    assert.throws(()=>reports.transactions({from:"2026-10-02",to:"2026-10-01"}),/Start date/);
    assert.throws(()=>reports.transactions({status:"Preparing"}),/filter/);
    const output=csv(reports.transactions({},true).transactions);
    assert.ok(output.includes("'=HYPERLINK"));
    assert.equal(output.split("\r\n").length,27);
  }finally{db.close();}
});
