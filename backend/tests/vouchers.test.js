const {test} = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const {fixture, customer, admin, body} = require("./fixtures");
const {createVoucherService, migrateVouchers} = require("../services/vouchers");
const {createOrderWorkflow} = require("../services/orderWorkflow");
process.env.JWT_SECRET = "isolated-voucher-test-secret-not-for-production";

test("vouchers persist normalized codes, preserve legacy promotion and validate admin input", () => {
  const db = fixture();
  try {
    const vouchers = createVoucherService(db);
    assert.equal(vouchers.resolve("kopi10"), 1000);
    assert.equal(vouchers.save({code:" welcome50 ", amount:50.25, active:true}).code, "WELCOME50");
    assert.equal(vouchers.resolve("welcome50"), 5025);
    assert.throws(() => vouchers.save({code:"WELCOME50",amount:50,active:true}), /already exists/);
    for (const amount of [-1, 0, 0.001, "50", null, NaN, Infinity, 1000001]) {
      assert.throws(() => vouchers.save({code:"INVALID",amount,active:true}));
    }
    for (const code of ["", "AB", "BAD CODE", "<script>", "X".repeat(33)]) {
      assert.throws(() => vouchers.save({code,amount:10,active:true}));
    }
    vouchers.save({amount:22,active:false}, "KOPI10");
    migrateVouchers(db);
    const saved = createVoucherService(db).list().find(row => row.code === "KOPI10");
    assert.equal(saved.amount, 22); assert.equal(saved.active, false);
    assert.throws(() => vouchers.resolve("KOPI10"), /inactive/);
    assert.throws(() => vouchers.save({amount:10,active:true}, "MISSING"), /not found/);
  } finally { db.close(); }
});

test("each one-time voucher gives a server-calculated deduction and cannot be redeemed again", () => {
  const db = fixture();
  try {
    const vouchers = createVoucherService(db), workflow = createOrderWorkflow(db);
    for (const [serviceType, code] of [[null,"ONLINE50"], ["Dine-in","DINE50"], ["Takeout","TAKE50"]]) {
      const inStore = Boolean(serviceType);
      vouchers.save({code,amount:50,active:true});
      const request = body({voucher:code,serviceType,expectedTotal:110,voucherDiscount:999});
      const quoted = workflow.prepareQuote(request,inStore);
      assert.equal(quoted.total,110); assert.equal(quoted.voucherDiscount,50);
      const order = workflow.create(request,inStore?admin:customer,inStore);
      assert.equal(order.total,110); assert.equal(order.voucherDiscount,50);
      assert.equal(db.prepare("SELECT voucher FROM orders WHERE id=?").get(order.orderId).voucher,code);
      assert.throws(() => workflow.prepareQuote(body({voucher:code,serviceType}),inStore), /already been used/);
    }
    vouchers.save({code:"MAXIMUM",amount:500,active:true});
    assert.equal(workflow.prepareQuote(body({voucher:"MAXIMUM"})).total,0);
    assert.equal(workflow.prepareQuote(body({voucher:"MAXIMUM"})).voucherDiscount,160);
  } finally { db.close(); }
});

test("redeemed vouchers remain blocked while saved checkout retries remain stable", () => {
  const db = fixture();
  try {
    const vouchers = createVoucherService(db),workflow=createOrderWorkflow(db);
    vouchers.save({code:"SAVE20",amount:20,active:true});
    const request=body({voucher:"SAVE20",expectedTotal:140});
    const order=workflow.create(request,customer);
    assert.throws(()=>workflow.prepareQuote(body({voucher:"SAVE20"})),/already been used/);
    vouchers.save({code:"INACTIVE20",amount:30,active:false});
    assert.throws(()=>workflow.prepareQuote(body({voucher:"INACTIVE20"})),/inactive/);
    assert.equal(workflow.create(request,customer).orderId,order.orderId);
    assert.equal(workflow.create(request,customer).total,140);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM orders").get().count,1);
  } finally { db.close(); }
});

test("canceling an order gives its one-time voucher back; completed orders keep it used", () => {
  const db=fixture();
  try {
    const vouchers=createVoucherService(db),workflow=createOrderWorkflow(db);
    vouchers.save({code:"BACK25",amount:25,active:true});
    const first=workflow.create(body({voucher:"BACK25",expectedTotal:135}),customer);
    assert.equal(vouchers.list().find(row=>row.code==="BACK25").used,true);
    assert.throws(()=>workflow.prepareQuote(body({voucher:"BACK25"})),/already been used/);
    workflow.cancel(first.orderId,customer);
    assert.equal(vouchers.list().find(row=>row.code==="BACK25").used,false);
    assert.equal(db.prepare("SELECT voucher_discount FROM orders WHERE id=?").get(first.orderId).voucher_discount,25);
    const second=workflow.create(body({voucher:"BACK25",expectedTotal:135}),customer);
    assert.equal(second.total,135);
    workflow.advance(second.orderId,"Preparing",admin);
    workflow.advance(second.orderId,"Out for Delivery",admin);
    workflow.advance(second.orderId,"Arrived",admin);
    workflow.advance(second.orderId,"Completed",admin);
    assert.throws(()=>workflow.prepareQuote(body({voucher:"BACK25"})),/already been used/);
    assert.equal(workflow.cancel(first.orderId,customer).status,"Canceled");
    assert.throws(()=>workflow.prepareQuote(body({voucher:"BACK25"})),/already been used/);
  } finally {db.close();}
});

test("POS retry keys include voucher choice and reject manual discounts", () => {
  const db=fixture();
  try {
    const vouchers=createVoucherService(db),workflow=createOrderWorkflow(db);
    vouchers.save({code:"SAVE10",amount:10,active:true});
    const request=body({serviceType:"Dine-in",voucher:"SAVE10",expectedTotal:150});
    const order=workflow.create(request,admin,true);
    assert.throws(()=>workflow.create({...request,voucher:"KOPI10"},admin,true),/different order/);
    vouchers.save({amount:20,active:false},"SAVE10");
    assert.equal(workflow.create(request,admin,true).orderId,order.orderId);
    assert.throws(()=>workflow.create(body({serviceType:"Dine-in",discount:15,expectedTotal:145}),admin,true),/Manual discounts are not allowed/);
  } finally {db.close();}
});

test("only authenticated admins can manage vouchers and customer checkout uses them immediately", async () => {
  const db=fixture(),app=express();
  app.use(express.json());
  app.use("/vouchers",require("../routes/vouchers")(db));
  app.use("/orders",require("../routes/orders")(db));
  const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  const request=async(route,method="GET",payload,user=admin)=>{
    const response=await fetch(`http://127.0.0.1:${server.address().port}${route}`,{
      method,headers:{"Content-Type":"application/json",...(user?{Authorization:"Bearer "+jwt.sign(user,process.env.JWT_SECRET)}:{})},
      ...(payload?{body:JSON.stringify(payload)}:{})
    });
    return {status:response.status,data:await response.json()};
  };
  try {
    assert.equal((await request("/vouchers","GET",null,null)).status,401);
    assert.equal((await request("/vouchers","GET",null,customer)).status,403);
    const payload={code:"SCHOOL25",amount:25,active:true};
    assert.equal((await request("/vouchers","POST",payload,customer)).status,403);
    assert.equal((await request("/vouchers","POST",payload)).status,201);
    assert.equal((await request("/vouchers","POST",payload)).status,409);
    assert.equal((await request("/orders/quote","POST",body({voucher:"school25"}),customer)).data.total,135);
    assert.equal((await request("/vouchers/SCHOOL25","PUT",{amount:35,active:true})).status,200);
    assert.equal((await request("/orders/quote","POST",body({voucher:"SCHOOL25"}),customer)).data.total,125);
    assert.equal((await request("/vouchers/SCHOOL25","PUT",{amount:35,active:false})).status,200);
    assert.equal((await request("/orders/quote","POST",body({voucher:"SCHOOL25"}),customer)).status,400);
    assert.equal((await request("/vouchers")).data.vouchers.find(row=>row.code==="SCHOOL25").active,false);
    assert.equal((await request("/vouchers/SCHOOL25","DELETE",null,customer)).status,403);
    assert.equal((await request("/vouchers/SCHOOL25","DELETE",null,null)).status,401);
    assert.equal((await request("/vouchers/SCHOOL25","DELETE")).status,200);
    assert.equal((await request("/vouchers")).data.vouchers.some(row=>row.code==="SCHOOL25"),false);
  } finally { await new Promise(resolve=>server.close(resolve));db.close(); }
});

test("removing a redeemed voucher preserves receipt deduction and cannot make its code reusable", () => {
  const db=fixture();
  try {
    const vouchers=createVoucherService(db),flow=createOrderWorkflow(db);
    vouchers.save({code:"USED25",amount:25.50,active:true});
    const request=body({voucher:"used25",expectedTotal:134.50});
    const order=flow.create(request,customer);
    assert.equal(order.voucher,"USED25");
    assert.equal(order.voucherDiscount,25.50);
    vouchers.remove("USED25");
    migrateVouchers(db);
    assert.equal(vouchers.list().some(row=>row.code==="USED25"),false);
    assert.throws(()=>vouchers.resolve("USED25"),/already been used/);
    assert.throws(()=>vouchers.save({code:"USED25",amount:20,active:true}),/already exists/);
    assert.throws(()=>vouchers.save({amount:20,active:true},"USED25"),/not found/);
    const recovered=flow.create(request,customer);
    assert.equal(recovered.orderId,order.orderId);
    assert.equal(recovered.voucher,"USED25");
    assert.equal(recovered.voucherDiscount,25.50);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM voucher_redemptions WHERE voucher_code='USED25'").get().n,1);
  } finally {db.close();}
});
