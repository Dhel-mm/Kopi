// Tests for the changes requested by the evaluation panel. They use isolated
// in-memory databases only: no real orders, stock or payments are touched.
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {fixture,customer,admin,body}=require("./fixtures");
const {quote}=require("../services/pricing");
const {createOrderWorkflow}=require("../services/orderWorkflow");
const {createOrderSafety,paymentProof,idPhoto}=require("../services/orderSafety");
const {describeStock,stockLevels}=require("../services/inventory");
const {createReports,summaryCsv}=require("../services/reports");
const staff={id:2,role:"Staff"};
// Sample records from the simulated registry (services/idRegistry.js).
const senior={type:"Senior Citizen",idNumber:"osca-cal-2019-00888",name:"Remedios Santos"};
const pwd={type:"PWD",idNumber:"04-3405-012-0001234",name:"Maria Santos"};
const idImage="data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const drinkAndMeal=[{productId:"americano",quantity:2,options:{Size:"ICED - 16oz"}},{productId:"tapa",quantity:1,options:{}}];

test("Senior Citizen/PWD: 20% discount and VAT exemption on one drink and one food item",()=>{
  const q=quote(body({items:drinkAndMeal,specialDiscount:senior}));
  assert.equal(q.subtotal,399);
  // ₱110 drink and ₱179 meal: VAT-exclusive 98.21 + 159.82; VAT 11.79 + 19.18; 20% = 19.64 + 31.96.
  assert.equal(q.specialDiscount.vatExempt,30.97);
  assert.equal(q.specialDiscount.discount,51.6);
  assert.equal(q.total,316.43);
  assert.equal(q.specialDiscount.idNumber,"OSCA-CAL-2019-00888");
  assert.deepEqual(q.specialDiscount.coveredItems.map(item=>[item.productId,item.quantity]),[["americano",1],["tapa",1]]);
  assert.throws(()=>quote(body({items:drinkAndMeal,voucher:"KOPI10",specialDiscount:senior}),false,()=>1000),/cannot be combined/);
  assert.throws(()=>quote(body({items:drinkAndMeal,specialDiscount:{...senior,idNumber:"1"}})),/OSCA ID control number/);
  assert.throws(()=>quote(body({items:drinkAndMeal,specialDiscount:{...senior,type:"Student"}})),/Senior Citizen or PWD/);
  assert.throws(()=>quote(body({items:drinkAndMeal,specialDiscount:senior}),true),/Check the customer's Senior Citizen ID/);
  assert.equal(quote(body({items:drinkAndMeal,specialDiscount:{...senior,idChecked:true}}),true).total,316.43);
});

test("Senior Citizen/PWD discount is saved on the order and returned with it",()=>{
  const db=fixture();
  try {
    const workflow=createOrderWorkflow(db);
    const order=workflow.create(body({items:drinkAndMeal,specialDiscount:pwd,specialDiscountProof:idImage,expectedTotal:316.43}),customer);
    assert.equal(order.total,316.43);
    assert.equal(order.specialDiscount.type,"PWD");
    assert.equal(order.specialDiscount.status,"Pending verification");
    assert.equal(order.specialDiscount.deduction,82.57);
    const row=db.prepare("SELECT special_discount,vat_exempt,special_discount_name FROM orders WHERE id=?").get(order.orderId);
    assert.deepEqual(row,{special_discount:51.6,vat_exempt:30.97,special_discount_name:"Maria Santos"});
  } finally {db.close();}
});

test("cash on delivery is limited; larger online orders must be prepaid by GCash",()=>{
  const db=fixture();
  try {
    const workflow=createOrderWorkflow(db);
    const big=[{productId:"caramel-frappe",quantity:10,options:{Size:"16oz"}}];
    assert.equal(workflow.prepareQuote(body({items:big})).cashOnDelivery.allowed,false);
    assert.equal(workflow.prepareQuote(body()).cashOnDelivery.allowed,true);
    assert.throws(()=>workflow.create(body({items:big,expectedTotal:1600}),customer),/Cash on delivery is available/);
    const prepaid=workflow.create(body({items:big,expectedTotal:1600,payment:"GCash",paymentReference:"1000000000001"}),customer);
    assert.equal(prepaid.paymentStatus,"Pending verification");
    // In-store orders are paid at the counter, so the limit does not apply there.
    assert.ok(workflow.create(body({items:big,expectedTotal:1600,serviceType:"Dine-in",cashTendered:1600}),{id:2,role:"Cashier"},true).orderId);
  } finally {db.close();}
});

test("GCash screenshot is optional, validated and stored separately",()=>{
  assert.equal(paymentProof("", "GCash"),null);
  assert.throws(()=>paymentProof("data:image/png;base64,AAAA","Cash"),/only be attached to a GCash/);
  assert.throws(()=>paymentProof("data:text/html;base64,AAAA","GCash"),/JPG, PNG or WebP/);
  assert.throws(()=>paymentProof("data:image/jpeg;base64,"+"A".repeat(400000),"GCash"),/too large/);
  const db=fixture();
  try {
    const workflow=createOrderWorkflow(db),safety=createOrderSafety(db);
    const order=workflow.create(body({payment:"GCash",paymentReference:"1000000000002",paymentProof:"data:image/jpeg;base64,/9j/4AAQ"}),customer);
    assert.equal(safety.proof(order.orderId).image,"data:image/jpeg;base64,/9j/4AAQ");
    const row=db.prepare("SELECT * FROM orders WHERE id=?").get(order.orderId);
    assert.equal(safety.describe(row).hasPaymentProof,true);
    assert.equal(safety.paymentWait(row,Date.parse(row.created_at.replace(" ","T")+"Z")+31*60000).overdue,true);
  } finally {db.close();}
});

test("risk flags, phone confirmation and rejecting a fake order with a customer notice",()=>{
  const db=fixture();
  try {
    const workflow=createOrderWorkflow(db),safety=createOrderSafety(db);
    const order=workflow.create(body(),customer);
    const row=()=>db.prepare("SELECT * FROM orders WHERE id=?").get(order.orderId);
    assert.deepEqual(safety.riskFlags(row()).map(flag=>flag.code),["first-order"]);
    assert.equal(safety.needsPhoneConfirmation(row()),true);
    const before=db.prepare("SELECT SUM(quantity) AS q FROM inventory_items").get().q;
    assert.throws(()=>safety.reject(order.orderId,{reason:"other",note:""},staff,workflow),/short note/);
    assert.throws(()=>safety.reject(order.orderId,{reason:"nope"},staff,workflow),/Choose a reason/);
    assert.throws(()=>safety.reject(order.orderId,{reason:"address"},{id:1,role:"Customer"},workflow),/staff access/);
    const rejected=safety.reject(order.orderId,{reason:"address",note:"No such street in Lingga."},staff,workflow);
    assert.equal(rejected.status,"Canceled");
    assert.ok(db.prepare("SELECT SUM(quantity) AS q FROM inventory_items").get().q>before,"reserved stock returns");
    const notice=require("../services/paymentReview").createPaymentReviewService(db).pending(customer);
    assert.equal(notice.length,1);
    assert.match(notice[0].message,/delivery address was incomplete.*No such street/);
    const next=workflow.create(body(),customer);
    const nextRow=db.prepare("SELECT * FROM orders WHERE id=?").get(next.orderId);
    assert.ok(safety.riskFlags(nextRow).some(flag=>flag.code==="past-rejections"));
    workflow.advance(next.orderId,"Preparing",admin);
    assert.throws(()=>safety.reject(next.orderId,{reason:"duplicate"},staff,workflow),/Only a new online order/);
  } finally {db.close();}
});

test("low stock uses package baseline, average daily usage, lead time, safety days or a manual level",()=>{
  const item={id:1,sku:"milk",quantity:3000,initial_quantity:1000,lead_time_days:2,safety_days:1,reorder_level_override:null};
  assert.equal(describeStock(item).reorderLevel,250);
  assert.equal(describeStock(item).reorderBasis,"Package");
  const usage=new Map([[1,14000]]); // 1 L per day over 14 days
  const busy=describeStock(item,usage);
  assert.equal(busy.averageDailyUsage,1000);
  assert.equal(busy.reorderLevel,3000);
  assert.equal(busy.status,"Low Stock");
  assert.equal(busy.daysLeft,3);
  assert.equal(describeStock({...item,reorder_level_override:500},usage).status,"In Stock");
  assert.equal(describeStock({...item,quantity:0}).status,"Out of Stock");
  const db=fixture();
  try {
    const workflow=createOrderWorkflow(db);
    workflow.create(body({items:[{productId:"caramel-frappe",quantity:5,options:{Size:"16oz"}}],expectedTotal:800}),customer);
    const caramel=stockLevels(db).find(row=>row.item.sku==="caramel-syrup");
    assert.ok(caramel.level.averageDailyUsage>0);
  } finally {db.close();}
});

test("sales summary covers a day, the current month and earlier months",()=>{
  const db=fixture();
  try {
    const reports=createReports(db,()=>new Date("2026-10-21T04:00:00Z"));
    const insert=(id,completed,total,extra={})=>{
      db.prepare(`INSERT INTO orders(id,order_number,user_id,order_type,service_type,status,payment,subtotal,total,voucher_discount,
        special_discount,vat_exempt,special_discount_type,created_at,completed_at,canceled_at) VALUES(?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id,"T-"+id,extra.type||"In-store",extra.service||"Dine-in",extra.status||"Completed",extra.payment||"Cash",
          extra.subtotal??total,total,extra.voucher||0,extra.special||0,extra.vat||0,extra.sc||null,completed,extra.status==="Canceled"?null:completed,extra.status==="Canceled"?completed:null);
      db.prepare("INSERT INTO order_items(order_id,product_id,product_name,quantity,price) VALUES(?,?,?,?,?)").run(id,"americano","Americano",1,extra.subtotal??total);
    };
    insert(1,"2026-10-21 02:00:00",200,{payment:"GCash"});
    insert(2,"2026-10-21 03:00:00",316.43,{subtotal:399,special:51.6,vat:30.97,sc:"Senior Citizen"});
    insert(3,"2026-10-20 15:59:00",100);           // still Oct 20 in Manila (11:59 PM)
    insert(4,"2026-09-15 06:00:00",500,{type:"Online",service:"Delivery"});
    insert(5,"2026-10-21 05:00:00",90,{status:"Canceled"});
    const day=reports.salesSummary({period:"day",date:"2026-10-21"});
    assert.equal(day.orders,2);
    assert.equal(day.netSales,516.43);
    assert.equal(day.grossSales,599);
    assert.equal(day.specialDiscounts,51.6);
    assert.equal(day.seniorOrders,1);
    assert.equal(day.canceledOrders,1);
    assert.equal(day.previous.netSales,100);
    assert.equal(day.series.length,24);
    const month=reports.salesSummary({period:"month",month:"2026-10"});
    assert.equal(month.orders,3);
    assert.equal(month.through,"2026-10-21");
    assert.equal(month.previous.netSales,500);
    const september=reports.salesSummary({period:"month",month:"2026-09"});
    assert.equal(september.netSales,500);
    assert.equal(september.series.length,30);
    assert.equal(september.byType[0].type,"Online delivery");
    assert.throws(()=>reports.salesSummary({period:"month",month:"2026-13"}),/valid month/);
    assert.throws(()=>reports.salesSummary({period:"day",date:"2026-11-01"}),/today or an earlier date/);
    const year=reports.salesSummary({period:"year",year:"2026"});
    assert.equal(year.orders,4);
    assert.equal(year.series.length,12);
    assert.equal(year.series[8].label,"2026-09");
    assert.equal(year.series[8].total,500);
    assert.equal(year.previous.netSales,0);
    assert.throws(()=>reports.salesSummary({period:"year",year:"20x6"}),/valid year/);
    assert.equal(day.transactions,3);
    const week=reports.salesSummary({period:"week",date:"2026-10-21"});
    assert.equal(week.start,"2026-10-19");
    assert.equal(week.end,"2026-10-25");
    assert.equal(week.series.length,7);
    assert.equal(week.orders,3);
    assert.equal(week.netSales,616.43);
    assert.throws(()=>reports.salesSummary({period:"quarter"}),/daily, weekly, monthly or yearly/);
    assert.match(summaryCsv(day),/"Net sales \(PHP\)","516.43"/);
  } finally {db.close();}
});

test("ID formats follow the official PWD (PSGC-based) rule; OSCA numbers are checked by the registry",()=>{
  const {formatIdNumber}=require("../services/pricing");
  assert.equal(formatIdNumber("PWD","0434050120001234"),"04-3405-012-0001234");
  assert.equal(formatIdNumber("PWD","04-3405-031-00567"),"04-3405-031-00567"); // 5-digit sequence used by some LGUs
  for (const bad of ["12345","04-3405-012-00012345","99-3405-012-0001234","04-0005-012-0001234","04-34A5-012-0001234"]) {
    assert.throws(()=>formatIdNumber("PWD",bad),/PWD ID|region code|cannot be 00/);
  }
  assert.equal(formatIdNumber("Senior Citizen"," osca-cal-2016-00123 "),"OSCA-CAL-2016-00123");
  for (const bad of ["ABCD","12","OSCA"]) assert.throws(()=>formatIdNumber("Senior Citizen",bad),/OSCA ID control number/);
});

test("simulated OSCA/NCDA registry: found, same type, active, not expired, matching name, senior age 60+",()=>{
  const db=fixture();
  try {
    const {createIdRegistry}=require("../services/idRegistry");
    const registry=createIdRegistry(db,()=>new Date("2026-10-22T04:00:00Z"));
    const ok=registry.verify(senior);
    assert.deepEqual([ok.name,ok.age,ok.status],["Remedios Santos",76,"Active"]);
    assert.equal(registry.verify({...pwd,idNumber:"0434050120001234",name:"maria  santos"}).region,"Region IV-A (CALABARZON)");
    assert.equal(registry.verify({...senior,name:"Remedios L. Santos"}).name,"Remedios Santos"); // middle initial allowed
    assert.throws(()=>registry.verify({...senior,idNumber:"OSCA-CAL-2099-00001"}),/not found/);
    assert.throws(()=>registry.verify({...pwd,type:"Senior Citizen",idNumber:"OSCA-CAL-2016-00123"}),/name entered does not match/);
    assert.throws(()=>registry.verify({type:"PWD",idNumber:"13-7404-000-0004321",name:"Ana Reyes"}),/revoked\/invalid/);
    assert.throws(()=>registry.verify({type:"PWD",idNumber:"04-3405-031-00567",name:"Carlo Mendoza"}),/expired on 2025-12-31/);
    assert.throws(()=>registry.verify({type:"Senior Citizen",idNumber:"OSCA-CAL-2026-00456",name:"Rosa Lim"}),/58 years old/);
    assert.throws(()=>registry.verify({...senior,name:"Juan Dela Cruz"}),/does not match/);
    // Admin keeps the registry: add a new ID, then revoke it.
    const added=registry.save({type:"Senior Citizen",idNumber:"OSCA-CAL-2024-00321",name:"Lorna Garcia",birthDate:"1960-01-15",issuedBy:"OSCA Calamba City"});
    assert.equal(added.age,66);
    assert.equal(registry.verify({type:"Senior Citizen",idNumber:"OSCA-CAL-2024-00321",name:"Lorna Garcia"}).status,"Active");
    registry.setStatus("OSCA-CAL-2024-00321","Revoked");
    assert.throws(()=>registry.verify({type:"Senior Citizen",idNumber:"OSCA-CAL-2024-00321",name:"Lorna Garcia"}),/revoked/);
    assert.throws(()=>registry.save({type:"PWD",idNumber:"123",name:"A B",birthDate:"2000-01-01"}),/official format/);
    // In-store (POS) orders are refused when the registry rejects the ID.
    const workflow=createOrderWorkflow(db),cashier={id:2,role:"Cashier"};
    assert.throws(()=>workflow.create(body({items:drinkAndMeal,specialDiscount:{type:"PWD",idNumber:"13-7404-000-0004321",name:"Ana Reyes",idChecked:true},
      serviceType:"Dine-in",cashTendered:400,expectedTotal:316.43}),cashier,true),/revoked/);
    assert.equal(workflow.prepareQuote(body({items:drinkAndMeal,specialDiscount:{...senior,idChecked:true},serviceType:"Dine-in"}),true).specialDiscount.verification.age>=60,true);
    // Online orders no longer use the registry: staff verify the uploaded ID photo.
    assert.equal(workflow.prepareQuote(body({items:drinkAndMeal,specialDiscount:{type:"PWD",idNumber:"13-7404-000-0004321",name:"Ana Reyes"}})).specialDiscount.verification,undefined);
  } finally {db.close();}
});

test("online Senior Citizen/PWD discount needs an ID photo that staff verify like GCash before preparing",()=>{
  assert.equal(idPhoto("",null),null);
  assert.throws(()=>idPhoto(idImage,null),/only be attached when you apply/);
  assert.throws(()=>idPhoto("",senior),/Upload a clear photo of the Senior Citizen ID/);
  assert.throws(()=>idPhoto("data:application/pdf;base64,AAAA",senior),/JPG, PNG or WebP/);
  assert.throws(()=>idPhoto("data:image/jpeg;base64,"+"A".repeat(400000),senior),/too large/);
  const db=fixture();
  try {
    const workflow=createOrderWorkflow(db),safety=createOrderSafety(db);
    const notices=require("../services/paymentReview").createPaymentReviewService(db);
    const place=extra=>workflow.create(body({items:drinkAndMeal,specialDiscount:senior,expectedTotal:316.43,...extra}),customer);
    assert.throws(()=>place({}),/Upload a clear photo/);
    // Any real-looking OSCA number is accepted online; staff judge the photo.
    const order=place({specialDiscount:{...senior,idNumber:"2282130"},specialDiscountProof:idImage});
    const row=()=>db.prepare("SELECT * FROM orders WHERE id=?").get(order.orderId);
    assert.equal(safety.describe(row()).hasIdProof,true);
    assert.equal(safety.describe(row()).specialDiscountStatus,"Pending verification");
    assert.deepEqual({...safety.idProof(order.orderId),createdAt:undefined},{image:idImage,createdAt:undefined,type:"Senior Citizen",idNumber:"2282130",name:"Remedios Santos",status:"Pending verification"});
    assert.throws(()=>workflow.advance(order.orderId,"Preparing",admin),/Verify the customer's Senior Citizen \/ PWD ID/);
    assert.throws(()=>safety.verifyId(order.orderId,{},staff),/Compare the ID photo/);
    assert.throws(()=>safety.verifyId(order.orderId,{confirmedValid:true},{id:1,role:"Customer"}),/staff access/);
    assert.match(safety.verifyId(order.orderId,{confirmedValid:true},staff).message,/verified/);
    assert.equal(row().special_discount_verified_by,staff.id);
    assert.throws(()=>safety.disapproveId(order.orderId,{},staff,workflow),/already verified/);
    assert.equal(workflow.advance(order.orderId,"Preparing",admin).status,"Preparing");
    // An ID that is not approved keeps the order: the discount is removed, the
    // order returns to its normal price and the customer gets a notice.
    const second=place({specialDiscountProof:idImage});
    assert.throws(()=>safety.disapproveId(second.orderId,{},{id:1,role:"Customer"},workflow),/staff access/);
    const kept=safety.disapproveId(second.orderId,{note:"The name on the ID does not match."},staff,workflow);
    assert.equal(kept.status,"New");
    assert.equal(kept.total,399);
    assert.deepEqual([kept.specialDiscount.status,kept.specialDiscount.deduction,kept.specialDiscount.removed],["Not approved",0,82.57]);
    assert.equal(safety.disapproveId(second.orderId,{},staff,workflow).total,399,"a retry changes nothing");
    const notice=notices.pending(customer).find(entry=>entry.orderId===second.orderId);
    assert.equal(notice.type,"discount");
    assert.match(notice.message,/discount for order .* was not approved.*name on the ID does not match.*normal price of ₱399\.00.*₱82\.57 discount was removed.*Please pay ₱399\.00 to the rider/);
    notices.acknowledgeDiscount(second.orderId,customer);
    assert.equal(notices.pending(customer).some(entry=>entry.orderId===second.orderId),false);
    assert.equal(workflow.advance(second.orderId,"Preparing",admin).status,"Preparing","order continues at the normal price");
    // GCash customers sent the discounted amount; the rider collects the rest.
    const paid=place({payment:"GCash",paymentReference:"1000000000077",specialDiscountProof:idImage});
    safety.disapproveId(paid.orderId,{},staff,workflow);
    const paidRow=db.prepare("SELECT * FROM orders WHERE id=?").get(paid.orderId);
    assert.deepEqual([safety.describe(paidRow).gcashAmount,safety.describe(paidRow).balanceDue],[316.43,82.57]);
    assert.match(notices.pending(customer).find(entry=>entry.orderId===paid.orderId).message,/sent ₱316\.43 by GCash.*remaining ₱82\.57 in cash/);
    // In-store, the cashier checks the physical ID, so it is verified at once.
    const counter=workflow.create(body({items:drinkAndMeal,specialDiscount:{...senior,idChecked:true},serviceType:"Dine-in",cashTendered:400,expectedTotal:316.43}),{id:2,role:"Cashier"},true);
    assert.equal(counter.specialDiscount.status,"Verified");
    // Discounts saved before ID photos existed count as verified.
    db.prepare("UPDATE orders SET special_discount_status=NULL WHERE id=?").run(counter.orderId);
    require("../services/orderSafety").migrateOrderSafety(db);
    assert.equal(db.prepare("SELECT special_discount_status AS s FROM orders WHERE id=?").get(counter.orderId).s,"Verified");
  } finally {db.close();}
});

test("Senior Citizen/PWD ID routes: admin and staff can view, verify and reject; the registry admin API is gone",()=>{
  const fs=require("node:fs"),path=require("node:path");
  const read=file=>fs.readFileSync(path.join(__dirname,"..",file),"utf8");
  assert.match(read("routes/adminOrders.js"),/\/orders\/:id\/id-proof[\s\S]*verify-id[\s\S]*not-approve-id/);
  assert.match(read("routes/workforce.js"),/\/preparation\/:id\/id-proof", staff[\s\S]*verify-id", staff[\s\S]*not-approve-id", staff/);
  assert.match(read("routes/orders.js"),/\/:id\/discount\/acknowledge/);
  const registry=read("routes/idRegistry.js");
  assert.match(registry,/requireRole\("Admin", "Cashier"\)/);
  assert.doesNotMatch(registry,/router\.(put|patch)/);
  const operation=fs.readFileSync(path.join(__dirname,"../../Admin/Operation.html"),"utf8");
  assert.doesNotMatch(operation,/IdRegistry|idRegistryCard/);
  assert.match(operation,/id="selectedDiscountActions"/);
  assert.equal(fs.existsSync(path.join(__dirname,"../../Admin/IdRegistry.js")),false);
});

test("GCash follow-up is due after 5 minutes; SC/PWD orders waiting for an ID check show Verify Order",()=>{
  const {PAYMENT_FOLLOW_UP_MINUTES}=require("../services/orderSafety");
  assert.equal(PAYMENT_FOLLOW_UP_MINUTES,5);
  const db=fixture();
  try {
    const workflow=createOrderWorkflow(db),safety=createOrderSafety(db);
    const order=workflow.create(body({payment:"GCash",paymentReference:"1000000000088"}),customer);
    const row=db.prepare("SELECT * FROM orders WHERE id=?").get(order.orderId);
    const created=Date.parse(row.created_at.replace(" ","T")+"Z");
    assert.equal(safety.paymentWait(row,created+4*60000).overdue,false);
    assert.equal(safety.paymentWait(row,created+5*60000).overdue,true);
  } finally {db.close();}
  const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
  const node=()=>({addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null,classList:{toggle(){},remove(){}},replaceChildren(){},appendChild(){}});
  const context=vm.createContext({document:{getElementById:node,createElement:node,querySelectorAll:()=>[]},
    window:{addEventListener(){}},KopiApi:{request:async()=>({orders:[]})},KopiNotice:{toast(){},set(){}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../../Admin/Operation.js"),"utf8"),context);
  const label=order=>vm.runInContext("paymentActionLabel",context)({status:"New",payment:"Cash",...order});
  assert.equal(label({specialDiscountType:"Senior Citizen",specialDiscountStatus:"Pending verification"}),"Verify Order");
  assert.equal(label({specialDiscountType:"PWD",specialDiscountStatus:"Pending verification",payment:"GCash",paymentStatus:"Pending verification"}),"Verify Order");
  assert.equal(label({specialDiscountType:"PWD",specialDiscountStatus:"Verified"}),"See Details");
  assert.equal(label({payment:"GCash",paymentStatus:"Pending verification"}),"Verify GCash");
  assert.equal(label({specialDiscountType:"PWD",specialDiscountStatus:"Pending verification",status:"Canceled"}),"See Details");
});
