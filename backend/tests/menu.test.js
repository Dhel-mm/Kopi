// Menu Management: the administrator adds, edits, hides and archives items, and
// prices, ordering and the served menu follow. Isolated test databases only.
const {test}=require("node:test");
const assert=require("node:assert/strict");
const jwt=require("jsonwebtoken");
const {fixture,customer,admin,body}=require("./fixtures");
const menu=require("../services/menu");
const {priceItems}=require("../services/pricing");
const {createOrderWorkflow}=require("../services/orderWorkflow");
const {createApp}=require("../app");
process.env.JWT_SECRET="isolated-menu-test-secret";

// A 1x1 transparent PNG.
const PNG="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const drink=(overrides={})=>({name:"Ube Latte",category:"kopi",type:"drink",description:"Purple yam and espresso.",available:true,
  sizeLabel:"Size",defaultSize:"ICED - 16oz",sizes:[{name:"HOT - 12oz",price:120},{name:"ICED - 16oz",price:130}],
  choices:[{label:"Ice Level",values:["Normal Ice","Less Ice"],defaultValue:"Normal Ice"}],
  addOns:{price:30,values:["Oat milk","Espresso shot"]},imageData:PNG,...overrides});
function withMenu(run) {
  const db=fixture();
  try { menu.migrateMenu(db); return run(db,menu.createMenuService(db)); }
  finally { menu.reset(); db.close(); }
}

test("the form becomes the same product shape the menu already uses",()=>{
  const product=menu.productFromInput(drink());
  assert.deepEqual(product.prices,{"HOT - 12oz":120,"ICED - 16oz":130});
  assert.deepEqual(product.options.map(option=>[option.key,option.label,option.priceKey,option.defaultValue]),
    [["size","Size",true,"ICED - 16oz"],["ice","Ice Level",false,"Normal Ice"],["addons","Add-ons (worth ₱30)",false,null]]);
  // One "Regular" size means a single price and no size choice, like rice meals.
  const meal=menu.productFromInput(drink({type:"food",sizes:[{name:"Regular",price:165}],choices:[],addOns:null}));
  assert.deepEqual([meal.prices,meal.options],[{Regular:165},[]]);
  for (const [input,message] of [[{name:" "},/product name/],[{type:"dessert"},/Drink or Food/],[{sizes:[]},/between 1 and 10 sizes/],
    [{sizes:[{name:"A",price:0}]},/above ₱0/],[{sizes:[{name:"A",price:1},{name:"A",price:2}]},/listed twice/],
    [{defaultSize:"Venti"},/default size/],[{choices:[{label:"Ice Level",values:["A","a"]}]},/must be different/],
    [{choices:[{label:"Ice Level",values:["A"],defaultValue:"B"}]},/default for Ice Level/]]) {
    assert.throws(()=>menu.productFromInput(drink(input)),message);
  }
});

test("seeding copies the written menu once; new items need a recipe before they can be ordered",()=>withMenu((db,service)=>{
  assert.equal(service.list().products.length,45);
  menu.migrateMenu(db);
  assert.equal(service.list().products.length,45);
  const created=service.create(drink(),admin);
  assert.equal(created.id,"ube-latte");
  assert.equal(created.image.startsWith("MenuImages/"),true);
  assert.equal(service.imageFile(created.image.split("/")[1]).mime,"image/png");
  assert.equal(service.create(drink(),admin).id,"ube-latte-2");
  // Prices come from the live menu at once.
  const [line]=priceItems([{productId:"ube-latte",quantity:1,options:{Size:"HOT - 12oz"}}]);
  assert.equal(line.price,120);
  // No ingredients yet, so the order is refused until Recipe setup is done.
  const flow=createOrderWorkflow(db);
  const order={items:[{productId:"ube-latte",quantity:1,options:{Size:"HOT - 12oz"}}],expectedTotal:120,cashTendered:120};
  assert.throws(()=>flow.create(body(order),customer),/No ingredients set up yet/);
  db.prepare("UPDATE menu_recipes SET terms_json=? WHERE id='ube-latte|HOT - 12oz'").run(JSON.stringify([{sku:"coffee-beans",amount:18,unit:"g"}]));
  assert.equal(flow.create(body(order),customer).total,120);
}));

test("editing, availability and archiving change what can be ordered",()=>withMenu((db,service)=>{
  service.update("americano",drink({name:"Kopi Americano",sizes:[{name:"HOT - 12oz",price:105},{name:"ICED - 16oz",price:115}],imageData:""}),admin);
  const edited=menu.current().findProduct("americano");
  assert.equal(edited.name,"Kopi Americano");
  assert.equal(edited.image,"Menu/Kopi1.png");
  assert.equal(priceItems([{productId:"americano",quantity:1,options:{Size:"HOT - 12oz"}}])[0].price,105);
  // Existing recipes keep working after an edit.
  assert.equal(createOrderWorkflow(db).create(body({items:[{productId:"americano",quantity:1,options:{Size:"HOT - 12oz"}}],expectedTotal:105,cashTendered:105}),customer).total,105);

  service.setAvailable("americano",false,admin);
  assert.equal(menu.current().findProduct("americano").available,false);
  assert.throws(()=>priceItems([{productId:"americano",quantity:1,options:{Size:"HOT - 12oz"}}]),/not available right now/);
  service.setAvailable("americano",true,admin);

  service.archive("americano",true,admin);
  assert.equal(menu.current().findProduct("americano"),undefined);
  assert.deepEqual(service.list().archived.map(item=>item.id),["americano"]);
  assert.throws(()=>service.archive("americano",true,admin),/not found/);
  service.archive("americano",false,admin);
  assert.equal(menu.current().findProduct("americano").name,"Kopi Americano");
}));

test("new categories and bad photos are handled",()=>withMenu((db,service)=>{
  const item=service.create(drink({category:"",newCategory:"Seasonal Specials",type:"food",sizes:[{name:"Regular",price:99}],choices:[],addOns:null}),admin);
  assert.equal(item.category,"seasonal-specials");
  assert.equal(menu.current().categories.at(-1).name,"Seasonal Specials");
  assert.throws(()=>service.create(drink({imageData:""}),admin),/Add a photo/);
  assert.throws(()=>service.create(drink({imageData:"data:image/gif;base64,R0lGODlh"}),admin),/PNG, JPEG or WebP/);
  assert.throws(()=>service.create(drink({imageData:"data:image/png;base64,/9j/4AAQSkZJRg=="}),admin),/damaged/);
  assert.throws(()=>service.create(drink({category:"missing"}),admin),/Choose a category/);
}));

test("only administrators manage the menu; every page gets the live menu safely",async()=>{
  const db=fixture();
  menu.migrateMenu(db);
  const server=await new Promise(resolve=>{const s=createApp(db).listen(0,"127.0.0.1",()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=(path,id,method="GET",data)=>fetch(base+path,{method,headers:{"Content-Type":"application/json",
    ...(id?{Authorization:"Bearer "+jwt.sign({id,ver:0},process.env.JWT_SECRET)}:{})},...(data?{body:JSON.stringify(data)}:{})});
  try {
    assert.equal((await call("/api/admin/menu",1)).status,403);
    assert.equal((await call("/api/admin/menu")).status,401);
    assert.equal((await call("/api/admin/menu/products",1,"POST",drink())).status,403);
    const created=await call("/api/admin/menu/products",2,"POST",drink({name:"Ube </script> Latte"}));
    assert.equal(created.status,201);
    const {product}=await created.json();
    const script=await (await call("/Customer/Catalog.js")).text();
    assert.match(script,/Ube \\u003c\/script> Latte/);
    assert.doesNotMatch(script,/<\/script>/);
    const image=await call("/Customer/"+product.image);
    assert.equal(image.headers.get("content-type"),"image/png");
    assert.equal((await call("/Customer/MenuImages/999")).status,404);
    assert.equal((await call("/api/admin/menu/products/"+product.id+"/availability",2,"PATCH",{available:false})).status,200);
    assert.match(await (await call("/Customer/Catalog.js")).text(),/"available":false/);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    menu.reset();
    db.close();
  }
});
