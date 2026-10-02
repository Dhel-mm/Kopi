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

test("one voucher gives the same server-calculated deduction online, dine-in and takeout", () => {
  const db = fixture();
  try {
    const vouchers = createVoucherService(db), workflow = createOrderWorkflow(db);
    vouchers.save({code:"WELCOME50",amount:50,active:true});
    for (const serviceType of [null, "Dine-in", "Takeout"]) {
      const inStore = Boolean(serviceType);
      const request = body({voucher:"WELCOME50",serviceType,expectedTotal:110,voucherDiscount:999});
      const quoted = workflow.prepareQuote(request,inStore);
      assert.equal(quoted.total,110); assert.equal(quoted.voucherDiscount,50);
      const order = workflow.create(request,inStore?admin:customer,inStore);
      assert.equal(order.total,110); assert.equal(order.voucherDiscount,50);
      assert.equal(db.prepare("SELECT voucher FROM orders WHERE id=?").get(order.orderId).voucher,"WELCOME50");
    }
    assert.throws(() => workflow.prepareQuote(body({voucher:"WELCOME50",discount:5,serviceType:"Dine-in"}),true), /not both/);
    vouchers.save({amount:500,active:true},"WELCOME50");
    assert.equal(workflow.prepareQuote(body({voucher:"WELCOME50"})).total,0);
    assert.equal(workflow.prepareQuote(body({voucher:"WELCOME50"})).voucherDiscount,160);
  } finally { db.close(); }
});

test("changed or inactive vouchers block stale totals but saved checkout retries remain stable", () => {
  const db = fixture();
  try {
    const vouchers = createVoucherService(db),workflow=createOrderWorkflow(db);
    vouchers.save({code:"SAVE20",amount:20,active:true});
    const request=body({voucher:"SAVE20",expectedTotal:140});
    const order=workflow.create(request,customer);
    vouchers.save({amount:30,active:true},"SAVE20");
    assert.throws(()=>workflow.create(body({voucher:"SAVE20",expectedTotal:140}),customer),/total changed/);
    vouchers.save({amount:30,active:false},"SAVE20");
    assert.throws(()=>workflow.prepareQuote(body({voucher:"SAVE20"})),/inactive/);
    assert.throws(()=>workflow.create(body({voucher:"SAVE20",expectedTotal:130}),customer),/inactive/);
    assert.equal(workflow.create(request,customer).orderId,order.orderId);
    assert.equal(workflow.create(request,customer).total,140);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM orders").get().count,1);
  } finally { db.close(); }
});

test("POS retry keys include voucher choice and preserve normal manual discounts", () => {
  const db=fixture();
  try {
    const vouchers=createVoucherService(db),workflow=createOrderWorkflow(db);
    vouchers.save({code:"SAVE10",amount:10,active:true});
    const request=body({serviceType:"Dine-in",voucher:"SAVE10",expectedTotal:150});
    const order=workflow.create(request,admin,true);
    assert.throws(()=>workflow.create({...request,voucher:"KOPI10"},admin,true),/different order/);
    vouchers.save({amount:20,active:false},"SAVE10");
    assert.equal(workflow.create(request,admin,true).orderId,order.orderId);
    assert.equal(workflow.create(body({serviceType:"Dine-in",discount:15,expectedTotal:145}),admin,true).total,145);
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
  } finally { await new Promise(resolve=>server.close(resolve));db.close(); }
});
