const fs=require("node:fs");
const path=require("node:path");
const Database=require("better-sqlite3");
const bcrypt=require("bcryptjs");
require("dotenv").config({path:path.join(__dirname,"../.env"),quiet:true});
const {checkConfig}=require("../config");
const {verifyDatabase}=require("../services/backups");
const {createInventoryService}=require("../services/inventory");
const issues=checkConfig(process.env),warnings=[];
const filename=process.env.DATABASE_PATH||path.join(__dirname,"../data/kopi.db");
try {
  verifyDatabase(filename);
  const db=new Database(filename,{readonly:true,fileMustExist:true});
  try {
    const admins=db.prepare("SELECT password_hash FROM users WHERE role='Admin' AND status='Active'").all();
    if(!admins.length)issues.push("At least one active administrator is required.");
    if(admins.some(user=>bcrypt.compareSync("ChooseYourOwnStrongAdminPassword",user.password_hash)))issues.push("An administrator still uses the earlier shared placeholder password. Change it through Profile details & password.");
    const recipeIssues=createInventoryService(db).recipes().flatMap(recipe=>recipe.issues);
    if(recipeIssues.length)issues.push(...recipeIssues);
    const estimates=db.prepare("SELECT COUNT(*) AS n FROM inventory_unit_conversions WHERE is_estimate=1").get().n;
    if(estimates)warnings.push(estimates+" ingredient conversions are still starter estimates. Verify measured quantities before real sales.");
    const zeros=db.prepare("SELECT COUNT(*) AS n FROM inventory_items WHERE quantity<=0").get().n;
    if(zeros)warnings.push(zeros+" ingredients are out of stock; affected orders will be blocked.");
    const backups=path.join(path.dirname(path.resolve(filename)),"backups");
    const recent=fs.existsSync(backups)&&fs.readdirSync(backups).some(file=>file.endsWith(".db")&&Date.now()-fs.statSync(path.join(backups,file)).mtimeMs<86400000);
    if(!recent)warnings.push("No database backup from the last 24 hours. Run npm.cmd run backup and copy it to protected off-machine storage.");
  }finally{db.close();}
}catch(error){issues.push("Database readiness: "+error.message);}
const root=path.resolve(__dirname,"../..");
for(const directory of ["","Admin","Customer"]) {
  const base=path.join(root,directory);
  for(const filename of fs.readdirSync(base).filter(file=>file.endsWith(".html"))) {
    const html=fs.readFileSync(path.join(base,filename),"utf8");
    for(const match of html.matchAll(/(?:src|href)="([^"#?]+)(?:[?#][^"]*)?"/g)) {
      const reference=match[1];
      if(/^(https?:|data:|mailto:|tel:)/.test(reference))continue;
      if(!fs.existsSync(path.resolve(base,reference)))issues.push(directory+"/"+filename+" references missing file: "+reference);
    }
  }
}
console.log(JSON.stringify({readyForProduction:issues.length===0,issues:[...new Set(issues)],warnings,
  manualChecks:["Provision HTTPS and a persistent disk; do not publish the project folder directly.","Verify the domain, proxy configuration and off-machine backup recovery.","GCash remains manually verified; refunds are handled by staff."]},null,2));
if(issues.length)process.exitCode=1;
