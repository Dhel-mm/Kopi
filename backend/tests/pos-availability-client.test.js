const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../../Admin/Orders.js"),"utf8");

function harness() {
  const notices=[],calls=[],classes=new Set();
  let available=false,quoteError=null,quoteWait=null,label=null;
  const button={setAttribute(name,value){this[name]=value;}};
  const card={dataset:{productId:"sample"},isConnected:true,
    classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);}},
    querySelector(selector){return selector===".add-btn"?button:label;},
    appendChild(value){label=value;value.remove=()=>{label=null;};}
  };
  const product={id:"sample",name:"Sample drink",prices:{Regular:120},options:[]};
  const context={
    availabilityVersion:0,productClickPending:false,addingProduct:false,
    productAvailability:new Map(),POS_ORDER_API:"/workforce/orders",
    state:{orderType:"Dine-in",cart:[]},
    document:{body:{dataset:{workspace:"Cashier"}},createElement:()=>({})},
    productGridEl:{querySelectorAll:()=>[card]},
    KopiNotice:{toast:(message,kind)=>notices.push({message,kind})},
    KopiApi:{request:async(url,options)=>{
      calls.push({url,options});
      if(url.includes("/availability"))return {products:[{productId:"sample",available}]};
      if(quoteWait)await quoteWait;
      if(quoteError)throw quoteError;
      return {};
    }},
    findProductById:()=>product,getPopoverOptions:product=>product.options,
    renderOrder(){},openOptionsPopover(){},
  };
  vm.createContext(context);
  for(const [start,end] of [
    ["function paintProductAvailability(","function formatPriceLabel("],
    ["async function handleProductClick(","function openOptionsPopover("],
    ["async function addToCart(","/* ---------- Order panel ---------- */"]
  ]) vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end)),context);
  return {context,card,classes,button,product,notices,calls,label:()=>label,
    available(value){available=value;},reject(error){quoteError=error;},
    defer(){let done;quoteWait=new Promise(resolve=>{done=resolve;});return done;}};
}

test("out-of-stock cards turn red and clicking them shows the requested notice without adding an item",async()=>{
  const h=harness();
  await h.context.refreshProductAvailability();
  assert.ok(h.classes.has("is-unavailable"));
  assert.equal(h.label().textContent,"Not available");
  await h.context.handleProductClick("sample",h.card);
  assert.equal(h.notices.at(-1).message,"The Product is not available");
  assert.equal(h.context.state.cart.length,0);
  assert.equal(h.calls.filter(call=>call.options).length,0);
  h.available(true);
  await h.context.refreshProductAvailability();
  assert.ok(!h.classes.has("is-unavailable"));
  assert.equal(h.label(),null);
  assert.equal(await h.context.addToCart(h.product,"Regular",120),true);
  assert.equal(h.context.state.cart.length,1);
});

test("selected options and quantity are checked before changing the cart; failures keep the draft",async()=>{
  const h=harness();
  h.available(true);
  h.reject(Object.assign(new Error("Not enough ingredient"),{status:409}));
  await h.context.addToCart(h.product,"Regular",150,{"Add-ons (worth ₱30)":"Espresso shot"});
  const payload=JSON.parse(h.calls.find(call=>call.options).options.body);
  assert.equal(payload.items[0].options["Add-ons (worth ₱30)"],"Espresso shot");
  assert.equal(h.context.state.cart.length,0);
  assert.equal(h.notices.at(-1).message,"The Product is not available");
  h.reject(null);
  await h.context.addToCart(h.product,"Regular",120);
  await h.context.addToCart(h.product,"Regular",120);
  assert.equal(h.context.state.cart[0].quantity,2);
  assert.equal(JSON.parse(h.calls.filter(call=>call.options).at(-1).options.body).items[0].quantity,2);
});

test("an in-flight stock check cannot add to a reset or changed order",async()=>{
  const h=harness(),done=h.defer();
  const pending=h.context.addToCart(h.product,"Regular",120);
  h.context.state.orderType="Takeout";
  done();await pending;
  assert.equal(h.context.state.cart.length,0);
  assert.match(h.notices.at(-1).message,/order changed/);
});
