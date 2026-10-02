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
  app.use(express.json({limit:"400kb",strict:true}));
  app.get("/api/health",(req,res)=>{
    try {db.prepare("SELECT 1").get();res.json({status:"ok"});}
    catch {res.status(503).json({status:"unavailable"});}
  });
  app.use("/api/auth",require("./routes/auth")(db));
  app.use("/api",require("./routes/customer")(db));
  app.use("/api/orders",require("./routes/orders")(db));
  app.use("/api/admin",require("./routes/adminOrders")(db));
  app.use("/api/admin",require("./routes/reports")(db));
  app.use("/api/admin/inventory",require("./routes/inventory")(db));
  app.use("/api/admin/users",require("./routes/users")(db));
  app.use("/api/admin/vouchers",require("./routes/vouchers")(db));
  app.use("/api",(req,res)=>res.status(404).json({message:"API endpoint not found."}));
  app.get("/",(req,res)=>res.redirect("/splash.html"));
  // Only web assets are public. No project-root static directory, databases,
  // backups, configuration, tests, or prototype credential storage are served.
  const webAsset=/\.(?:html|css|js|png|jpe?g|jfif|webp|gif|svg|ico|woff2?)$/i;
  for (const directory of ["Customer","Admin"]) app.use("/"+directory,(req,res,next)=>{
    if (!webAsset.test(req.path)||req.path.split("/").some(part=>part.startsWith("."))) return res.sendStatus(404);
    next();
  },express.static(path.join(root,directory),{index:false,dotfiles:"deny",maxAge:0}));
  for (const file of ["login.html","login.css","signup.html","signup.css","splash.html","Splash.css","Auth.js","reset.html"]) {
    app.get("/"+file,(req,res)=>res.sendFile(path.join(root,file)));
  }
  app.use((req,res)=>res.status(404).send("Page not found."));
  app.use((error,req,res,next)=>{
    if (res.headersSent) return next(error);
    if (error.type==="entity.too.large") return res.status(413).json({message:"Request is too large. Profile photos must be under 250 KB."});
    if (error instanceof SyntaxError&&error.status===400) return res.status(400).json({message:"Request contains invalid JSON."});
    console.error("Request failed:",error.code||error.name);
    res.status(500).json({message:"The request could not be completed. Please try again."});
  });
  return app;
}
module.exports={createApp};
