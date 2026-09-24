const {createHash}=require("node:crypto");
function rateLimit(db,name,max=20,minutes=15) {
  return (req,res,next)=>{
    const now=Date.now();
    const bucket=createHash("sha256").update(name+":"+req.ip).digest("hex");
    const count=db.transaction(()=>{
      db.prepare("DELETE FROM request_limits WHERE expires_at<?").run(now);
      const record=db.prepare("SELECT * FROM request_limits WHERE bucket=?").get(bucket);
      if (record) db.prepare("UPDATE request_limits SET hits=hits+1 WHERE bucket=?").run(bucket);
      else db.prepare("INSERT INTO request_limits VALUES(?,1,?)").run(bucket,now+minutes*60000);
      return {hits:(record?.hits||0)+1,expires:record?.expires_at||now+minutes*60000};
    }).immediate();
    if (count.hits>max) {
      res.set("Retry-After",String(Math.max(1,Math.ceil((count.expires-now)/1000))));
      return res.status(429).json({message:"Too many attempts. Please try again later."});
    }
    next();
  };
}
module.exports={rateLimit};
