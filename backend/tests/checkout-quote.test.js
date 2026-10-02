const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

// Minimal DOM adapter exercises the real Cart.js handlers without touching
// browser storage, real orders, the shop database or a payment account.
class Element {
  constructor() {
    this.value="";this.dataset={};this.listeners={};
    this.hidden=true;this.disabled=false;this.innerHTML="";
    this.content={firstElementChild:{cloneNode:()=>new Element()}};
  }
  addEventListener(name,handler) { this.listeners[name]=handler; }
  setAttribute(name,value) { this[name]=value; }
  querySelector() { return new Element(); }
  querySelectorAll() { return []; }
  focus() {}
}
function checkout(request) {
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id)) elements.set(id,new Element());
    return elements.get(id);
  };
  const cash=new Element(),gcash=new Element();
  cash.dataset.payment="Cash";gcash.dataset.payment="GCash";
  element("paymentChoices").querySelectorAll=()=>[cash,gcash];
  element("paymentChoices").querySelector=()=>gcash;
  const items=[{productId:"cafe-latte",cartId:"test-cart",name:"Cafe Latte",quantity:1,price:1,options:{Size:"ICED - 16oz"}}];
  const source=fs.readFileSync(path.join(__dirname,"../../Customer/Cart.js"),"utf8");
  const app=vm.runInNewContext(source+";({refreshCheckoutQuote})",{
    window:{location:{search:"?checkout=1"}},URLSearchParams,structuredClone,
    document:{getElementById:element,addEventListener(){}},
    KopiStore:{
      getCheckout:()=>items,getAddress:()=>"",
      cartCount:entries=>entries.reduce((sum,item)=>sum+item.quantity,0),
      cartTotal:entries=>entries.reduce((sum,item)=>sum+item.quantity*item.price,0)
    },
    KopiApi:{getSession:()=>({user:{id:1}}),hasPendingOrder:()=>false,request},
    KopiNotice:{toast(){},set(element,message){element.textContent=message;}},alert:()=>{},navigator:{}
  });
  return {app,element,cash,gcash};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const validQuote={items:[{productId:"cafe-latte",name:"Cafe Latte",quantity:1,price:120,options:{Size:"ICED - 16oz"}}],subtotal:120,deliveryFee:0,voucherDiscount:0,total:120};

test("checkout shows server totals and hides GCash until a valid quote",async()=>{
  let resolveQuote;
  const ui=checkout(()=>new Promise(resolve=>{resolveQuote=resolve;}));
  assert.equal(ui.element("orderNowBtn").disabled,true);
  assert.equal(ui.gcash.disabled,true);
  assert.equal(ui.element("gcashPanel").hidden,true);
  resolveQuote(validQuote);await tick();
  assert.equal(ui.element("checkoutTotal").textContent,"₱ 120.00");
  assert.equal(ui.element("orderNowBtn").disabled,false);
  assert.equal(ui.gcash.disabled,false);
  ui.gcash.listeners.click();
  assert.equal(ui.element("gcashPanel").hidden,false);
  ui.element("voucherCode").listeners.input();
  assert.equal(ui.element("orderNowBtn").disabled,true);
  assert.equal(ui.element("gcashPanel").hidden,true);
  assert.match(ui.element("checkoutQuoteStatus").textContent,/Click Apply/);
});

test("a stale quote response cannot re-enable an edited checkout",async()=>{
  let resolveQuote;
  const ui=checkout(()=>new Promise(resolve=>{resolveQuote=resolve;}));
  ui.element("voucherCode").value="KOPI10";
  ui.element("voucherCode").listeners.input();
  resolveQuote(validQuote);await tick();
  assert.equal(ui.element("orderNowBtn").disabled,true);
  assert.equal(ui.gcash.disabled,true);
  assert.match(ui.element("checkoutQuoteStatus").textContent,/Voucher changed/);
});

test("stock or pricing rejection keeps payment and order submission blocked",async()=>{
  const ui=checkout(async()=>{throw new Error("Not available: Caramel Frappe.");});
  await tick();
  assert.equal(ui.element("orderNowBtn").disabled,true);
  assert.equal(ui.gcash.disabled,true);
  assert.equal(ui.element("gcashPanel").hidden,true);
  assert.equal(ui.element("checkoutQuoteStatus").textContent,"Not available: Caramel Frappe.");
});
