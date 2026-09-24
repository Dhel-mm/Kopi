const path=require("node:path");
require("dotenv").config({path:path.join(__dirname,"../.env"),quiet:true});
const {copyDatabase}=require("../services/backups");
const source=process.env.DATABASE_PATH||path.join(__dirname,"../data/kopi.db");
const destination=path.join(path.dirname(path.resolve(source)),"backups","kopi-"+new Date().toISOString().replace(/[:.]/g,"-")+".db");
copyDatabase(source,destination).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
