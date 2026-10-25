const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const crypto=require("node:crypto");

function storage() {
  const data=new Map();
  return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)};
}
function api(fetch) {
  const localStorage=storage(),sessionStorage=storage();
  localStorage.setItem("kopi_api_session",JSON.stringify({user:{id:1},token:"test-only"}));
  const source=fs.readFileSync(path.join(__dirname,"../../Customer/Api.js"),"utf8");
  const instance=vm.runInNewContext(source+";KopiApi",{
    window:{location:{protocol:"http:"}},localStorage,sessionStorage,fetch,
    TextEncoder,Uint8Array,crypto:crypto.webcrypto
  });
  return {instance,localStorage,sessionStorage};
}
const response=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});

test("browser preserves the checkout key after a lost response and recovers without another POST",async()=>{
  const calls=[];
  const {instance}=api(async(url,options={})=>{
    calls.push({url,options});
    if(options.method==="POST") throw new TypeError("Network response lost");
    return response(200,{orderId:42,total:160});
  });
  const payload={items:[{productId:"caramel-frappe",quantity:1}],expectedTotal:160};
  await assert.rejects(()=>instance.placeOrder("/orders",payload),/lost/);
  const saved=instance.pendingOrder("/orders");
  assert.ok(saved.requestKey);
  await assert.rejects(()=>instance.placeOrder("/orders",{...payload,expectedTotal:120}),/Recover previous/);
  assert.equal(calls.length,1);
  assert.equal((await instance.recoverOrder("/orders")).orderId,42);
  assert.equal(calls.filter(call=>call.options.method==="POST").length,1);
  assert.ok(calls[1].url.endsWith(saved.requestKey));
  instance.finishOrder("/orders");
  assert.equal(instance.hasPendingOrder("/orders"),false);
});

test("recovery resends only the frozen original payload and same key if the server has no saved order",async()=>{
  const posts=[];
  const {instance}=api(async(url,options={})=>{
    if(options.method!=="POST") return response(404,{message:"Not saved"});
    const payload=JSON.parse(options.body);posts.push(payload);
    if(posts.length===1) throw new TypeError("Offline");
    return response(201,{orderId:8,total:120});
  });
  const payload={items:[{productId:"cafe-latte",quantity:1,options:{Size:"ICED - 16oz"}}],expectedTotal:120};
  await assert.rejects(()=>instance.placeOrder("/orders",payload));
  assert.equal((await instance.recoverOrder("/orders")).orderId,8);
  assert.deepEqual(posts[0],posts[1]);
});

test("definitive validation rejections allow corrections; pending orders are isolated by user",async()=>{
  let reject=true;
  const {instance,localStorage}=api(async()=>reject?response(400,{message:"Invalid phone"}):response(201,{orderId:1}));
  await assert.rejects(()=>instance.placeOrder("/orders",{phone:"bad"}),/Invalid phone/);
  assert.equal(instance.hasPendingOrder("/orders"),false);
  reject=false;
  await instance.placeOrder("/orders",{phone:"09123456789"});
  assert.equal(instance.hasPendingOrder("/orders"),true);
  localStorage.setItem("kopi_api_session",JSON.stringify({user:{id:2}}));
  assert.equal(instance.hasPendingOrder("/orders"),false);
});

test("closing a receipt removes only purchased cart quantities, not other items or Buy Now carts",()=>{
  const localStorage=storage();
  const source=fs.readFileSync(path.join(__dirname,"../../Customer/Store.js"),"utf8");
  const store=vm.runInNewContext(source+";KopiStore",{
    localStorage,KopiCatalog:{categories:[]},document:{addEventListener(){},querySelectorAll(){return [];}}
  });
  const item={cartId:"cart-a",productId:"americano",options:{Size:"HOT - 12oz"},quantity:3,price:100};
  store.saveCart([item,{cartId:"cart-b",productId:"nachos",quantity:1,price:155}]);
  store.consumeCheckout([{...item,cartId:"buy-now",quantity:1}]);
  assert.equal(store.getCart()[0].quantity,3);
  store.consumeCheckout([{...item,quantity:2}]);
  assert.equal(store.getCart()[0].quantity,1);
  assert.equal(store.getCart().length,2);
  store.consumeCheckout([{...item,options:{Size:"ICED - 16oz"},quantity:1}]);
  assert.equal(store.getCart()[0].quantity,1);
});

test("each account has its own cart and address; a guest cart moves into the account that logs in",()=>{
  const localStorage=storage(),sessionStorage=storage();
  const source=fs.readFileSync(path.join(__dirname,"../../Customer/Store.js"),"utf8");
  localStorage.setItem("kopiCart",JSON.stringify([{cartId:"old",productId:"tapa",quantity:1,price:179}]));
  localStorage.setItem("kopiAddress","Someone else's house");
  const store=vm.runInNewContext(source+";KopiStore",{
    localStorage,sessionStorage,KopiCatalog:{categories:[]},document:{addEventListener(){},querySelectorAll(){return [];}}
  });
  const login=id=>sessionStorage.setItem("kopi_api_session",JSON.stringify({user:{id}}));
  // Unowned data from before this update is cleared.
  assert.equal(localStorage.getItem("kopiCart"),null);
  assert.equal(store.getCart().length,0);
  assert.equal(store.getAddress(),"");
  // Guest adds an item, then logs in as account 1: the item moves with them.
  store.addToCart({productId:"americano",options:{Size:"HOT - 12oz"},quantity:2,price:100});
  login(1);
  assert.equal(store.getCart().length,1);
  assert.equal(store.getCart()[0].quantity,2);
  store.setAddress("Blk 1 Lot 2, Lingga");
  // A different (new) account starts empty.
  login(2);
  assert.equal(store.getCart().length,0);
  assert.equal(store.getAddress(),"");
  // Account 1 still has its own cart and address.
  login(1);
  assert.equal(store.getCart()[0].quantity,2);
  assert.equal(store.getAddress(),"Blk 1 Lot 2, Lingga");
});
