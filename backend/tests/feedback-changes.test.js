// Tests for the second round of client and panel changes. They use isolated
// in-memory databases only: no real orders, stock or accounts are touched.
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const jwt=require("jsonwebtoken");
const {fixture,customer,admin,body}=require("./fixtures");
const {createOrderWorkflow}=require("../services/orderWorkflow");
const menuData=require("../services/menu");
const {createMenuService}=menuData;
const {createInventoryService}=require("../services/inventory");
const {createApp}=require("../app");
process.env.JWT_SECRET="isolated-feedback-test-secret";
const read=file=>fs.readFileSync(path.join(__dirname,"../..",file),"utf8");
const frappe=(quantity=1)=>({productId:"caramel-frappe",quantity,options:{Size:"16oz"}});

async function server(run) {
  const db=fixture();
  db.prepare(`INSERT INTO users(id,first_name,last_name,email,password_hash,role)
    VALUES(4,'Test','Cashier','cashier@test.invalid','unused','Cashier')`).run();
  const app=createApp(db);
  const listening=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  const base=`http://127.0.0.1:${listening.address().port}`;
  const request=async(url,method="GET",data,id=1)=>{
    const response=await fetch(base+"/api"+url,{method,headers:{"Content-Type":"application/json",
      Authorization:"Bearer "+jwt.sign({id,ver:0},process.env.JWT_SECRET)},...(data===undefined?{}:{body:JSON.stringify(data)})});
    return {status:response.status,data:await response.json()};
  };
  try {await run({db,request});}
  finally {await new Promise(resolve=>listening.close(resolve));db.close();}
}

test("the most of an item that can be made counts the rest of the order and shared ingredients",()=>{
  const db=fixture();
  try {
    const workflow=createOrderWorkflow(db);
    const perCup=createInventoryService(db).requirements(require("../services/pricing").priceItems([frappe()]),false)
      .find(item=>item.sku==="caramel-syrup").amount;
    db.prepare("UPDATE inventory_items SET quantity=? WHERE sku='caramel-syrup'").run(perCup*3);
    const three=workflow.stockCheck({item:frappe(3)});
    assert.deepEqual([three.ok,three.maxQuantity,three.message],[true,3,""]);
    const four=workflow.stockCheck({item:frappe(4)});
    assert.deepEqual([four.ok,four.maxQuantity],[false,3]);
    assert.match(four.message,/Not enough ingredients for Caramel Frappe\. You can only add up to 3\./);
    // Customers are told it ran short, not which ingredient or how much is left.
    assert.doesNotMatch(four.message,/syrup|\d+ ?(g|ml)\b/i);
    assert.equal(workflow.stockCheck({item:frappe(2),others:[frappe(2)]}).maxQuantity,1);
    db.prepare("UPDATE inventory_items SET quantity=0 WHERE sku='caramel-syrup'").run();
    const none=workflow.stockCheck({item:frappe()});
    assert.deepEqual([none.ok,none.maxQuantity],[false,0]);
    assert.match(none.message,/No more can be added/);
  } finally {db.close();}
});

test("stock check is open to customers only and a GCash order needs its receipt",()=>server(async({request})=>{
  assert.equal((await request("/orders/stock-check","POST",{item:frappe()})).data.ok,true);
  assert.equal((await request("/orders/stock-check","POST",{item:frappe()},4)).status,403);
  const missing=await request("/orders","POST",{...body({payment:"GCash",paymentReference:"1000000000090"}),paymentProof:""});
  assert.equal(missing.status,400);
  assert.match(missing.data.message,/screenshot of your GCash receipt/);
}));

test("a new menu item can bring its ingredients, including one that is not in Inventory yet",()=>{
  const db=fixture();
  try {
    menuData.migrateMenu(db);
    const menu=createMenuService(db);
    const item={name:"Ube Latte",type:"drink",sizeLabel:"Size",sizes:[{name:"12oz",price:120},{name:"16oz",price:150}],
      imageData:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="};
    const category="kopi";
    const created=menu.create({...item,category,ingredients:[
      {newIngredient:{name:"Ube Syrup",category:"Syrups",measurement:"ml",quantity:2000,packageQuantity:1000},amounts:{"12oz":20,"16oz":30}},
      {sku:"caramel-syrup",unit:db.prepare("SELECT measurement FROM inventory_items WHERE sku='caramel-syrup'").get().measurement,amounts:{"16oz":5}}
    ]},admin);
    const stock=db.prepare("SELECT * FROM inventory_items WHERE sku='ube-syrup'").get();
    assert.deepEqual([stock.product_name,stock.quantity,stock.measurement,stock.initial_quantity],["Ube Syrup",2000,"ml",1000]);
    const recipe=size=>JSON.parse(db.prepare("SELECT terms_json FROM menu_recipes WHERE id=?").get(`${created.id}|${size}`).terms_json);
    assert.deepEqual(recipe("12oz").map(term=>[term.sku,term.amount]),[["ube-syrup",20]]);
    assert.deepEqual(recipe("16oz").map(term=>[term.sku,term.amount]),[["ube-syrup",30],["caramel-syrup",5]]);
    // The item can be sold at once, and every size needs an amount.
    const workflow=createOrderWorkflow(db);
    assert.ok(workflow.stockCheck({item:{productId:created.id,quantity:1,options:{Size:"12oz"}}}).maxQuantity>0);
    assert.throws(()=>menu.create({...item,name:"Half Latte",category,ingredients:[{sku:"ube-syrup",unit:"ml",amounts:{"12oz":20}}]},admin),/ingredient amount for 16oz/);
    assert.equal(db.prepare("SELECT 1 FROM menu_products WHERE id='half-latte'").get(),undefined,"a rejected item leaves nothing behind");
    assert.throws(()=>menu.create({...item,name:"Twice",category,ingredients:[
      {sku:"ube-syrup",unit:"ml",amounts:{"12oz":1,"16oz":1}},{sku:"ube-syrup",unit:"ml",amounts:{"12oz":2,"16oz":2}}]},admin),/listed twice/);
  } finally {menuData.reset();db.close();}
});

test("user movements are recorded with who did what, without any password",()=>server(async({db,request})=>{
  const stock=db.prepare("SELECT id,product_name FROM inventory_items WHERE sku='caramel-syrup'").get();
  assert.equal((await request(`/admin/inventory/${stock.id}/add-stock`,"PATCH",{amount:50},2)).status,200);
  assert.equal((await request(`/admin/inventory/${stock.id}/add-stock`,"PATCH",{amount:-1},2)).status,400);
  const order=await request("/orders","POST",body({payment:"GCash",paymentReference:"1000000000091"}));
  assert.equal(order.status,201);
  assert.equal((await request(`/workforce/verifications/${order.data.orderId}/verify-payment`,"PATCH",{confirmedReceived:true},4)).status,200);
  await request("/me/presence","POST",{});
  const log=await request("/admin/activity","GET",undefined,2);
  assert.equal(log.status,200);
  const summary=log.data.rows.map(row=>[row.userName,row.role,row.area,row.action]);
  assert.deepEqual(summary,[
    ["Test Cashier","Cashier","Orders","Verified GCash payment"],
    ["Test Customer","Customer","Orders","Placed online order"],
    ["Test Admin","Admin","Inventory","Added stock"]]);
  assert.match(log.data.rows[2].details,/\+50/);
  assert.equal(log.data.rows[1].details,order.data.orderNumber);
  assert.deepEqual(log.data.areas,["Inventory","Orders"]);
  assert.equal((await request("/admin/activity?role=Cashier","GET",undefined,2)).data.total,1);
  assert.equal((await request("/admin/activity?q=Added","GET",undefined,2)).data.total,1);
  assert.equal((await request("/admin/activity","GET",undefined,4)).status,403);
}));

test("pages match the requested wording and controls",()=>{
  const cart=read("Customer/Cart.html");
  assert.match(cart,/Priority Delivery/);
  assert.doesNotMatch(cart,/As soon as possible/);
  assert.doesNotMatch(cart,/9551778760/,"the GCash number is not shown: QR only");
  assert.doesNotMatch(read("Customer/Cart.js"),/9551778760/);
  assert.match(cart,/Note:<\/strong> Delivery fee is paid separately\./);
  assert.match(cart,/data-action="select"/);
  assert.doesNotMatch(cart,/delete-btn/);
  // The Order Updates button sits in My Cart, not in the top navigation.
  for (const page of ["Homepage","Menu","Account"]) {
    const html=read(`Customer/${page}.html`);
    assert.doesNotMatch(html,/orderBell|nav-bell|OrderBell\.js/,page);
  }
  assert.doesNotMatch(cart,/nav-bell/);
  const heading=cart.slice(cart.indexOf('<div class="cart-heading">'),cart.indexOf('<div class="cart-list"'));
  assert.match(heading,/id="orderBell"/);
  assert.match(cart,/OrderBell\.js/);
  assert.match(read("Customer/Menu.html"),/<input id="quantityValue"/);
  assert.match(read("signup.html"),/name="password" minlength="8"/);
  for (const page of ["Dashboard","Operation","Transactions","Reports","Inventory","Menu","Users","Settings","Activity"]) {
    const html=read(`Admin/${page}.html`);
    assert.match(html,/<span>Sales Report<\/span>/,page);
    assert.doesNotMatch(html,/Analytics/,page);
    assert.match(html,/href="Activity\.html"/,page);
  }
  assert.doesNotMatch(read("Admin/Dashboard.js"),/doughnut|"pie"/);
  assert.doesNotMatch(read("Admin/Users.js"),/method: *"DELETE"|"DELETE"/);
  assert.doesNotMatch(read("Staff/Staff.js"),/verify-payment|verify-id|not-approve-id|payment-proof|id-proof/);
  assert.match(read("Cashier/Workspace.js"),/Verify\.html[\s\S]*Inventory\.html/);
});

test("delivery address lists come from the official location codes and fill one another",()=>{
  const vm=require("node:vm");
  const context={window:{}};
  vm.runInNewContext(read("Customer/PhLocations.js"),context);
  const provinces=context.window.KopiLocations;
  assert.deepEqual(Array.from(provinces,province=>province.name),["Batangas","Cavite","Laguna","Quezon","Rizal"]);
  const calamba=provinces.find(province=>province.name==="Laguna").cities.find(city=>city.name==="Calamba City");
  assert.equal(calamba.barangays.length,54);
  assert.ok(calamba.barangays.includes("Lingga"));
  // The page uses dropdowns for province, city and barangay; the street is typed.
  const cart=read("Customer/Cart.html");
  for (const id of ["addressProvince","addressCity","addressBarangay"]) assert.match(cart,new RegExp(`<select id="${id}"`));
  assert.match(cart,/<input id="addressStreet"/);
  // House number/street and landmark share one row.
  assert.match(cart,/<label for="addressStreet">/);
  assert.match(cart,/<label for="addressLandmark">/);
  // Archive lives inside Manage, not in the Actions column.
  const users=read("Admin/Users.js");
  assert.doesNotMatch(users,/data-action="archive"|data-action="restore"/);
  assert.match(read("Admin/Users.html"),/id="archiveUserBtn"/);
  // Manage keeps its Active / Inactive choice.
  assert.match(read("Admin/Users.html"),/id="userStatusLabel"[\s\S]*<option>Active<\/option>[\s\S]*<option>Inactive<\/option>/);
  assert.match(users,/getElementById\("userStatusLabel"\)\.hidden = action === "create";/);
  // The lists fill one another, and a saved address is chosen again.
  const source=read("Customer/Cart.js");
  const start=source.indexOf("// Province → city/municipality → barangay");
  const options=[];
  const select=()=>({tagName:"SELECT",value:"",disabled:false,children:[],listeners:{},
    replaceChildren(...items){this.children=items;this.value="";},addEventListener(name,fn){this.listeners[name]=fn;},
    set chosen(v){this.value=v;}});
  const fields={province:select(),city:select(),barangay:select()};
  const sandbox={KopiLocations:provinces,addressFields:fields,
    Option:function(text,value){this.text=text;this.value=value;options.push(this);}};
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start,source.indexOf("\n",source.indexOf("setPlace();",start))),sandbox);
  // Selects keep the value only if it is one of their options.
  for (const field of Object.values(fields)) Object.defineProperty(field,"value",{get(){return this._v||"";},set(v){this._v=this.children.some(o=>o.value===v)?v:"";}});
  // A new account starts with nothing chosen: "Choose province", and the rest wait.
  sandbox.setPlace();
  assert.deepEqual([fields.province.value,fields.city.value,fields.barangay.value],["","",""]);
  assert.equal(fields.province.children[0].text,"Choose province");
  assert.deepEqual([fields.city.disabled,fields.barangay.disabled],[true,true]);
  sandbox.setPlace({province:"Laguna",city:"City of Calamba",barangay:"Brgy. Lingga"});
  assert.deepEqual([fields.province.value,fields.city.value,fields.barangay.value],["Laguna","Calamba City","Lingga"]);
  assert.equal(fields.barangay.children.length,55,"54 barangays and the placeholder");
  fields.province.value="Cavite";
  fields.province.listeners.change();
  assert.equal(fields.city.value,"");
  assert.ok(fields.city.children.some(option=>option.value==="Dasmariñas City"));
  assert.equal(fields.barangay.disabled,true,"no barangays until a city is chosen");
});

test("forgot password emails a single-use code, but only to an email that has an account",()=>server(async({db})=>{
  const bcrypt=require("bcryptjs");
  const sent=[];
  const app=createApp(db,{mailer:{configured:true,send:async message=>{sent.push(message);return {delivered:true};}}});
  const listening=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  const post=async(url,data)=>{
    const response=await fetch(`http://127.0.0.1:${listening.address().port}/api${url}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
    return {status:response.status,data:await response.json()};
  };
  try {
    db.prepare("UPDATE users SET password_hash=? WHERE id=1").run(bcrypt.hashSync("old-password",4));
    const unknown=await post("/auth/forgot-password",{email:"nobody@test.invalid"});
    assert.equal(unknown.status,404);
    assert.match(unknown.data.message,/No account uses this email/);
    assert.equal((await post("/auth/forgot-password",{email:"not-an-email"})).status,400);
    const asked=await post("/auth/forgot-password",{email:"Customer@Test.invalid"});
    assert.equal(asked.status,200,JSON.stringify(asked.data));
    assert.match(asked.data.message,/sent to cu\*+@test\.invalid/);
    assert.equal(sent.length,1);
    assert.equal(sent[0].to,"customer@test.invalid");
    const code=/recovery code is: (\d+)/.exec(sent[0].text)[1];
    assert.match(code,/^\d{6}$/,"a short 6-digit code");
    assert.ok(!db.prepare("SELECT 1 FROM password_resets WHERE token_hash=?").get(code),"the code is stored only as a hash");
    // One email a minute.
    const again=await post("/auth/forgot-password",{email:"customer@test.invalid"});
    assert.equal(again.status,429);
    assert.ok(again.data.waitSeconds>0);
    assert.equal(sent.length,1);
    // The short code only works with the email it was sent to.
    assert.match((await post("/auth/reset-password",{code,newPassword:"new-password"})).data.message,/Enter the email of your account/);
    assert.equal((await post("/auth/reset-password",{code,newPassword:"new-password",email:"other@test.invalid"})).status,400);
    const wrong=code==="000000"?"000001":"000000";
    assert.match((await post("/auth/reset-password",{code:wrong,newPassword:"new-password",email:"customer@test.invalid"})).data.message,/incorrect\. 4 tries left/);
    // The code from the email sets a new password once.
    assert.equal((await post("/auth/reset-password",{code,newPassword:"new-password",email:"customer@test.invalid"})).status,200);
    assert.equal((await post("/auth/reset-password",{code,newPassword:"another-one",email:"customer@test.invalid"})).status,400);
    assert.equal((await post("/auth/login",{email:"customer@test.invalid",password:"old-password"})).status,401);
    assert.equal((await post("/auth/login",{email:"customer@test.invalid",password:"new-password"})).status,200);
    db.prepare("UPDATE users SET status='Inactive' WHERE id=3").run();
    assert.equal((await post("/auth/forgot-password",{email:"other@test.invalid"})).status,403);
    assert.match(read("reset.html"),/id="recoveryEmailForm"[\s\S]*type="email"[\s\S]*id="resetForm"/);
  } finally {await new Promise(resolve=>listening.close(resolve));}
}));

test("an emailed recovery code stops working after 5 wrong tries",()=>server(async({db})=>{
  const sent=[];
  const app=createApp(db,{mailer:{configured:true,send:async message=>{sent.push(message);return {delivered:true};}}});
  const listening=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  const post=async(url,data)=>{
    const response=await fetch(`http://127.0.0.1:${listening.address().port}/api${url}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
    return {status:response.status,data:await response.json()};
  };
  try {
    assert.equal((await post("/auth/forgot-password",{email:"customer@test.invalid"})).status,200);
    const code=/recovery code is: (\d{6})/.exec(sent[0].text)[1];
    const wrong=code==="111111"?"222222":"111111";
    for (let i=0;i<5;i++) assert.equal((await post("/auth/reset-password",{code:wrong,newPassword:"new-password",email:"customer@test.invalid"})).status,400);
    const blocked=await post("/auth/reset-password",{code,newPassword:"new-password",email:"customer@test.invalid"});
    assert.equal(blocked.status,429);
    assert.match(blocked.data.message,/Too many wrong codes/);
    // A shop-issued long code still works without an email.
    const crypto=require("node:crypto");
    db.prepare("INSERT INTO password_resets(token_hash,user_id,expires_at,issued_by) VALUES(?,?,?,2)")
      .run(crypto.createHash("sha256").update("123456789012").digest("hex"),1,Date.now()+60000);
    assert.equal((await post("/auth/reset-password",{code:"123456789012",newPassword:"from-the-shop"})).status,200);
  } finally {await new Promise(resolve=>listening.close(resolve));}
}));
