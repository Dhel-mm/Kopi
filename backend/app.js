const express=require("express");
const path=require("node:path");

function createApp(db,settings={}) {
  const app=express();
  const root=path.resolve(__dirname,"..");
  app.disable("x-powered-by");
  app.set("trust proxy",settings.trustProxy||false);
  app.use((req,res,next)=>{
    res.set({
      "X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY",
      "Referrer-Policy":"strict-origin-when-cross-origin","Permissions-Policy":"camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "Cross-Origin-Resource-Policy":"same-origin"
    });
    if (settings.production) res.set("Strict-Transport-Security","max-age=31536000");
    if (req.path.startsWith("/api/")) {
      res.set("Cache-Control","no-store");
      const origin=req.headers.origin;
      const allowed=new Set([settings.origin]);
      if (!settings.production) {
        allowed.add("http://localhost:"+(settings.port||3000));
        allowed.add("http://127.0.0.1:"+(settings.port||3000));
      }
      if (origin&&!allowed.has(origin)) return res.status(403).json({message:"Use the website from its configured address."});
    }
    next();
  });
  // Room for two compressed photos (GCash screenshot and Senior Citizen / PWD ID).
  // Menu photos (up to 1 MB) are sent as text, so Menu Management allows larger requests.
  app.use("/api/admin/menu",express.json({limit:"1600kb",strict:true}));
  app.use(express.json({limit:"800kb",strict:true}));
  const activity=require("./services/activityLog");
  activity.migrateActivityLog(db);
  app.use("/api",activity.activityMiddleware(db));
  app.get("/api/health",(req,res)=>{
    try {db.prepare("SELECT 1").get();res.json({status:"ok"});}
    catch {res.status(503).json({status:"unavailable"});}
  });
  // Which menu items can be made from current stock, for the customer menu (no quantities shared).
  const availability=require("./services/productAvailability").createProductAvailability(db);
  app.get("/api/menu/availability",(req,res)=>{
    try {res.set("Cache-Control","no-store").json({products:availability.list("Takeout")});}
    catch(error){require("./services/orderWorkflow").sendError(res,error);}
  });
  app.use("/api/auth",require("./routes/auth")(db,settings));
  app.use("/api",require("./routes/customer")(db));
  app.use("/api/orders",require("./routes/orders")(db));
  app.use("/api/workforce",require("./routes/workforce")(db));
  app.use("/api/admin",require("./routes/adminOrders")(db));
  app.use("/api/admin",require("./routes/reports")(db));
  app.use("/api/admin/inventory",require("./routes/inventory")(db));
  app.use("/api/admin/users",require("./routes/users")(db,settings));
  app.use("/api/admin/activity",require("./routes/activity")(db));
  app.use("/api/admin/vouchers",require("./routes/vouchers")(db));
  app.use("/api/admin/menu",require("./routes/menu")(db));
  app.use("/api/id-registry",require("./routes/idRegistry")(db));
  app.use("/api",(req,res)=>res.status(404).json({message:"API endpoint not found."}));
  app.get("/",(req,res)=>res.redirect("/splash.html"));
  // POS order entry belongs to the Cashier workspace. Preserve old bookmarks
  // by sending Admin's retired Orders page to Operations.
  app.get("/Admin/Orders.html",(req,res)=>res.redirect(302,"/Admin/Operation.html"));
  // The menu every page uses comes from Menu Management, not the written file.
  const menu=require("./services/menu");
  app.get("/Customer/Catalog.js",(req,res)=>{
    const {categories}=menu.current();
    // "<" is escaped so a product name can never end the script early.
    const data=JSON.stringify(categories).replace(/</g,"\\u003c");
    res.type("application/javascript").set("Cache-Control","no-store").send(
      "/* Live menu from Menu Management. */\n"+
      `(function(root){"use strict";const categories=${data};`+
      "const products=categories.flatMap(group=>group.products.map(product=>({...product,category:group.id})));"+
      "root.KopiCatalog={categories,products,findProduct:id=>products.find(product=>product.id===id)};})(globalThis);\n");
  });
  app.get("/Customer/MenuImages/:id",(req,res)=>{
    const file=/^\d+$/.test(req.params.id)?menu.createMenuService(db).imageFile(req.params.id):null;
    if (!file) return res.sendStatus(404);
    res.type(file.mime).set("Cache-Control","public, max-age=31536000, immutable").send(file.data);
  });
  // Only web assets are public. No project-root static directory, databases,
  // backups, configuration, tests, or prototype credential storage are served.
  // Audio files are allowed for custom order alert sounds (Admin/sounds/).
  const webAsset=/\.(?:html|css|js|png|jpe?g|jfif|webp|gif|svg|ico|woff2?|mp3|wav|ogg|m4a)$/i;
  for (const directory of ["Customer","Admin","Cashier","Staff"]) app.use("/"+directory,(req,res,next)=>{
    if (!webAsset.test(req.path)||req.path.split("/").some(part=>part.startsWith("."))) return res.sendStatus(404);
    next();
  },express.static(path.join(root,directory),{index:false,dotfiles:"deny",maxAge:0}));
  for (const file of ["login.html","login.css","signup.html","signup.css","splash.html","Splash.css","Auth.js","reset.html","verify.html","change-password.html"]) {
    app.get("/"+file,(req,res)=>res.sendFile(path.join(root,file)));
  }
  app.use((req,res)=>res.status(404).send("Page not found."));
  app.use((error,req,res,next)=>{
    if (res.headersSent) return next(error);
    if (error.type==="entity.too.large") return res.status(413).json({message:"Request is too large. Profile photos must be under 250 KB and menu photos under 1 MB."});
    if (error instanceof SyntaxError&&error.status===400) return res.status(400).json({message:"Request contains invalid JSON."});
    console.error("Request failed:",error.code||error.name);
    res.status(500).json({message:"The request could not be completed. Please try again."});
  });
  return app;
}
module.exports={createApp};
