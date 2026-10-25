// Transaction Management: interval totals, items and change per row, order type
// filters and the export menu formats. Isolated test databases only.
const {test}=require("node:test");
const assert=require("node:assert/strict");
const jwt=require("jsonwebtoken");
const {fixture,customer,admin,body}=require("./fixtures");
const {createOrderWorkflow}=require("../services/orderWorkflow");
const {createReports,reportCsv}=require("../services/reports");
const {createApp}=require("../app");
process.env.JWT_SECRET="isolated-transaction-report-test-secret";

function orders(db) {
  const flow=createOrderWorkflow(db);
  const store=flow.create({...body({serviceType:"Dine-in",cashTendered:200}),address:"",phone:""},admin,true);
  flow.advance(store.orderId,"Completed",admin);
  const pickup=flow.create(body({serviceType:"Pickup",address:""}),customer);
  for (const next of ["Preparing","Ready for Pickup","Completed"]) flow.advance(pickup.orderId,next,admin);
  const canceled=flow.create(body(),customer);
  flow.cancel(canceled.orderId,customer);
  return {store,pickup,canceled};
}

test("totals cover every matching transaction; rows carry items and change",()=>{
  const db=fixture();
  try {
    const {store,pickup,canceled}=orders(db);
    const reports=createReports(db);
    const all=reports.transactions({});
    assert.deepEqual(all.totals,{transactions:3,completed:2,canceled:1,amount:320,averageOrder:160});
    const row=all.transactions.find(entry=>entry.id===store.orderId);
    assert.equal(row.items,"Caramel Frappe x1");
    assert.deepEqual([row.cashTendered,row.cashChange],[200,40]);
    assert.equal(all.transactions.find(entry=>entry.id===canceled.orderId).cashChange,null);
    // Order type filters, including online pickup and delivery.
    assert.deepEqual(reports.transactions({type:"Pickup"}).transactions.map(entry=>entry.id),[pickup.orderId]);
    assert.deepEqual(reports.transactions({type:"Delivery"}).transactions.map(entry=>entry.id),[canceled.orderId]);
    assert.deepEqual(reports.transactions({type:"Dine-in"}).totals,{transactions:1,completed:1,canceled:0,amount:160,averageOrder:160});
    assert.deepEqual(reports.transactions({status:"Canceled"}).totals,{transactions:1,completed:0,canceled:1,amount:0,averageOrder:0});
    assert.throws(()=>reports.transactions({type:"Drive-thru"}),/Invalid transaction filter/);
    // The default export format puts a summary block above the rows.
    const sheet=reportCsv(reports.transactions({},true),"Today, Oct 25, 2026");
    assert.match(sheet,/^﻿"Kopi; Calamba transaction report"/);
    assert.match(sheet,/"Interval","Today, Oct 25, 2026"/);
    assert.match(sheet,/"Total amount \(PHP, completed orders\)","320.00"/);
    assert.match(sheet,/"Caramel Frappe x1","Cash","160.00","200.00","40.00","Completed"/);
  } finally {db.close();}
});

test("report and export endpoints are admin-only and return each format",async()=>{
  const db=fixture();
  orders(db);
  const server=await new Promise(resolve=>{const s=createApp(db).listen(0,"127.0.0.1",()=>resolve(s));});
  const call=(path,id=2)=>fetch(`http://127.0.0.1:${server.address().port}/api/admin${path}`,
    {headers:{Authorization:"Bearer "+jwt.sign({id,ver:0},process.env.JWT_SECRET)}});
  try {
    assert.equal((await call("/transactions/report",1)).status,403);
    const report=await (await call("/transactions/report")).json();
    assert.equal(report.transactions.length,3);
    assert.equal(report.totals.amount,320);
    const json=await call("/transactions/export?format=json&label=All%20time");
    assert.match(json.headers.get("content-disposition"),/kopi-transactions\.json/);
    const parsed=await json.json();
    assert.deepEqual([parsed.interval,parsed.totals.transactions,parsed.transactions.length],["All time",3,3]);
    const sheet=await call("/transactions/export?format=report&label=All%20time");
    assert.match(sheet.headers.get("content-disposition"),/kopi-transaction-report\.csv/);
    assert.match(await sheet.text(),/"Interval","All time"/);
    const plain=await call("/transactions/export");
    assert.match(await plain.text(),/"Transaction ID","Settled at \(UTC\)"/);
    assert.equal((await call("/transactions/export?format=pdf")).status,400);
  } finally {await new Promise(resolve=>server.close(resolve));db.close();}
});
