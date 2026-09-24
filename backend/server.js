const path=require("node:path");
require("dotenv").config({path:path.join(__dirname,".env"),quiet:true});
const settings=require("./config").config();
const db=require("./database");
const app=require("./app").createApp(db,settings);
const server=app.listen(settings.port,settings.host,()=>{
  console.log("Kopi backend: "+settings.origin);
  console.log(settings.production?"Production mode enabled.":"Local development mode. Run npm.cmd run check:launch before deployment.");
});
server.on("error",error=>{
  console.error(error.code==="EADDRINUSE"?"The configured port is already in use. Stop the previous backend first.":"Could not start server: "+error.code);
  db.close();process.exitCode=1;
});
let stopping=false;
function shutdown() {
  if(stopping)return;
  stopping=true;
  const timeout=setTimeout(()=>process.exit(1),10000);timeout.unref();
  server.close(()=>{db.close();clearTimeout(timeout);process.exit(0);});
  server.closeIdleConnections();
}
process.on("SIGINT",shutdown);
process.on("SIGTERM",shutdown);
