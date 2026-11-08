// Customer menu availability follows ingredient stock, and the sales report's
// extra insights add up. Isolated test databases only.
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {fixture,customer,admin,body}=require("./fixtures");
const {createOrderWorkflow}=require("../services/orderWorkflow");
const {createReports}=require("../services/reports");
const {createApp}=require("../app");
process.env.JWT_SECRET="isolated-stock-availability-test-secret";

test("the public menu availability marks drinks unavailable when an ingredient runs out",async()=>{
  const db=fixture();
  const server=await new Promise(resolve=>{const s=createApp(db).listen(0,"127.0.0.1",()=>resolve(s));});
  const list=async()=>(await (await fetch(`http://127.0.0.1:${server.address().port}/api/menu/availability`)).json()).products;
  try {
    assert.equal((await list()).every(item=>item.available),true);
    db.prepare("UPDATE inventory_items SET quantity=0 WHERE sku='coffee-beans'").run();
    const after=await list();
    const unavailable=new Set(after.filter(item=>!item.available).map(item=>item.productId));
    assert.equal(unavailable.has("americano"),true);
    assert.equal(unavailable.has("milky-chocolate"),false);
    // No stock amounts are shared publicly.
    assert.deepEqual(Object.keys(after[0]).sort(),["available","productId","unavailable"]);
    // A missing ingredient for one size marks just that size sold out.
    db.prepare("UPDATE inventory_items SET quantity=100000 WHERE sku='coffee-beans'").run();
    db.prepare("UPDATE inventory_items SET quantity=0 WHERE sku='tube-ice'").run();
    const americano=(await list()).find(item=>item.productId==="americano");
    assert.deepEqual([americano.available,americano.unavailable],[true,{Size:["ICED - 16oz"]}]);
    db.prepare("UPDATE inventory_items SET quantity=100000 WHERE sku='tube-ice'").run();
    db.prepare("UPDATE inventory_items SET quantity=100000 WHERE sku='coffee-beans'").run();
    assert.equal((await list()).every(item=>item.available),true);
  } finally {await new Promise(resolve=>server.close(resolve));db.close();}
});

test("the sales report adds items sold, busiest hour, vouchers, customers and categories",()=>{
  const db=fixture();
  try {
    const flow=createOrderWorkflow(db);
    const store=flow.create({...body({serviceType:"Dine-in",items:[{productId:"caramel-frappe",quantity:2,options:{Size:"16oz"}}],expectedTotal:320,cashTendered:320}),address:"",phone:""},admin,true);
    flow.advance(store.orderId,"Completed",admin);
    const online=flow.create(body({serviceType:"Pickup",address:""}),customer);
    for (const next of ["Preparing","Ready for Pickup","Completed"]) flow.advance(online.orderId,next,admin);
    const today=new Date(Date.now()+8*3600e3).toISOString().slice(0,10);
    const report=createReports(db).salesSummary({period:"day",date:today});
    assert.equal(report.insights.itemsSold,3);
    assert.equal(report.insights.itemsPerOrder,1.5);
    assert.equal(report.insights.vouchersUsed,0);
    assert.equal(report.insights.onlineCustomers,1);
    assert.equal(report.insights.returningCustomers,0);
    assert.equal(report.insights.peakHour.orders,2);
    assert.equal(report.insights.busiestDay,null);
    assert.deepEqual(report.byCategory.map(row=>[row.quantity,row.sales]),[[3,480]]);
    assert.equal(createReports(db).salesSummary({period:"week",date:today}).insights.busiestDay.orders,2);
  } finally {db.close();}
});

test("online orders allow up to 50 drinks and 25 meals and snacks; in-store orders are not limited",()=>{
  const {quote}=require("../services/pricing");
  const drinks=quantity=>({productId:"caramel-frappe",quantity,options:{Size:"16oz"}});
  const snacks=quantity=>({productId:"nachos",quantity,options:{}});
  assert.doesNotThrow(()=>quote({items:[drinks(30),drinks(20)]}));
  assert.throws(()=>quote({items:[drinks(30),drinks(21)]}),/up to 50 drinks/);
  assert.doesNotThrow(()=>quote({items:[snacks(25),drinks(50)]}));
  assert.throws(()=>quote({items:[snacks(26)]}),/up to 25 meals and snacks/);
  assert.doesNotThrow(()=>quote({items:[drinks(60)]},true));
});
