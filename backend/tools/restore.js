const {copyDatabase}=require("../services/backups");
// Restores to a NEW path only. Stop the server and set DATABASE_PATH to the
// verified result to switch databases. The current database remains recoverable.
const [source,destination]=process.argv.slice(2);
if(!source||!destination){
  console.error('Usage: npm.cmd run restore -- "backup-file.db" "new-restored-file.db"');
  process.exitCode=1;
}else copyDatabase(source,destination).then(result=>console.log(JSON.stringify(result,null,2)))
  .catch(error=>{console.error(error.message);process.exitCode=1;});
