const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const read=file=>fs.readFileSync(path.join(__dirname,"../..",file),"utf8");

function element(tag="div") {
  const selectors=new Map(),classes=new Set();
  return {tag,children:[],listeners:{},dataset:{},value:"",validity:{valid:true},
    setAttribute(name,value){this[name]=value;},
    classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);},add(name){classes.add(name);},remove(name){classes.delete(name);},contains(name){return classes.has(name);}},
    addEventListener(name,fn){this.listeners[name]=fn;},append(...items){this.children.push(...items);},appendChild(item){this.children.push(item);},
    querySelector(selector){if(!selectors.has(selector))selectors.set(selector,element());return selectors.get(selector);},
    showModal(){this.open=true;},close(value=""){this.returnValue=value;this.open=false;this.listeners.close?.();},remove(){this.removed=true;},focus(){this.focused=true;}
  };
}

test("customer receipt shows saved voucher code, exact deduction and total rather than current checkout input",()=>{
  const ids=new Map(),get=id=>{if(!ids.has(id))ids.set(id,element());return ids.get(id);};
  const source=read("Customer/Cart.js");
  const context={document:{getElementById:get},placedOrder:null,activeTotals:null,activeCheckoutItems:[],
    orderNowBtn:element(),formatMoney:n=>Number(n).toFixed(2),
    receiptHeadTemplate:{content:{firstElementChild:{cloneNode:()=>element()}}},
    receiptRowTemplate:{content:{firstElementChild:{cloneNode:()=>element()}}}};
  for(const id of ["receiptOrderNo","receiptDate","receiptItems","receiptTotal","receiptModal"])context[id]=get(id);
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("function displaySavedOrder("),source.indexOf('document.getElementById("recoverCheckoutBtn")')),context);
  vm.runInContext(source.slice(source.indexOf("function showReceipt("),source.indexOf("function bindItemActions(")),context);
  const saved={orderNumber:"KOPI-001",items:[{name:"Coffee",quantity:1,price:160}],subtotal:160,deliveryFee:0,total:134.5,
    voucher:"SAVE25",voucherDiscount:25.5,payment:"Cash",paymentStatus:"Unpaid",status:"New"};
  context.displaySavedOrder(saved);
  assert.equal(get("receiptVoucherRow").hidden,false);
  assert.equal(get("receiptVoucherCode").textContent,"Voucher (SAVE25)");
  assert.equal(get("receiptVoucherDiscount").textContent,"− ₱ 25.50");
  assert.equal(get("receiptTotal").textContent,"₱ 134.50");
  assert.equal(get("receiptPaymentStatus").textContent,"Cash payment due on delivery.");
  context.displaySavedOrder({...saved,voucher:"",voucherDiscount:0,total:160,status:"Completed",paymentStatus:"Paid"});
  assert.equal(get("receiptVoucherRow").hidden,true);
  assert.equal(get("receiptPaymentStatus").textContent,"Paid — Cash payment received.");
  context.displaySavedOrder({...saved,payment:"GCash",paymentStatus:"Verified"});
  assert.match(get("receiptPaymentStatus").textContent,/^Paid/);
  context.displaySavedOrder({...saved,payment:"GCash",paymentStatus:"Pending verification"});
  assert.match(get("receiptPaymentStatus").textContent,/awaiting staff verification/);
});

test("cash received starts neutral, turns red on validation and clears when enough cash is entered",()=>{
  const input=element("input"),line=element(),amount=element();
  const source=read("Admin/Orders.js");
  const context={document:{getElementById:id=>({cashTendered:input,cashChangeLine:line,cashChangeAmount:amount})[id]},
    state:{voucherQuote:null,cart:[{price:240,quantity:1}]},formatMoney:n=>"₱"+n.toFixed(2)};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("function currentOrderTotal("),source.indexOf("/* ---------- Place / cancel order ---------- */")),context);
  context.updateCashCalculator();
  assert.equal(input.classList.contains("cash-required"),false);assert.equal(input["aria-invalid"],"false");
  context.updateCashCalculator(true);
  assert.equal(input.classList.contains("cash-required"),true);
  input.value="200";context.updateCashCalculator();assert.equal(input.classList.contains("cash-required"),true);
  input.value="500";context.updateCashCalculator();
  assert.equal(input.classList.contains("cash-required"),false);assert.equal(amount.textContent,"₱260.00");
});

for(const payment of ["Cash","GCash"]) test(`${payment} cancellation dialog has correct message and safe contact link only for GCash`,async()=>{
  const body=element("body");
  const source=read("Customer/Account.js");
  const context={document:{body,getElementById:()=>null,createElement:element,activeElement:null}};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("function confirmOrderCancellation(")),context);
  const result=context.confirmOrderCancellation({payment});
  const dialog=body.children[0],message=dialog.children[1],actions=dialog.children[2];
  assert.equal(dialog.open,true);
  assert.equal(message.textContent,"Cancel this order? If preparation has started, ingredients remain deducted.");
  if(payment==="GCash") {
    const link=message.children.find(child=>child.tag==="a");
    assert.equal(link.textContent,"Contact the shop");
    assert.equal(link.href,"https://www.facebook.com/kopiest2021");
    assert.equal(link.rel,"noopener noreferrer");
    assert.equal(message.children.at(-1)," for any GCash refund.");
  } else assert.equal(message.children.length,0);
  assert.equal(actions.children[0].focused,true);
  actions.children[0].listeners.click();assert.equal(await result,false);
  const confirmed=context.confirmOrderCancellation({payment});
  body.children[1].children[2].children[1].listeners.click();assert.equal(await confirmed,true);
});

test("recovery help links to the shop without exposing the opener",()=>{
  assert.match(read("reset.html"),/Never share your password with staff\. <a href="https:\/\/www.facebook.com\/kopiest2021" target="_blank" rel="noopener noreferrer">Click here<\/a>/);
});
