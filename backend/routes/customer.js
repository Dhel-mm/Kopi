const express=require("express");
const {authFor}=require("../middleware/auth");
const {rateLimit}=require("../middleware/rateLimit");
const accounts=require("../services/accounts");
const {OrderError}=require("../services/pricing");
const {sendError}=require("../services/orderWorkflow");

function validateAvatar(data) {
  if (typeof data!=="string" || data.length>350000) throw new OrderError("Choose a PNG or JPEG image no larger than 250 KB.");
  const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match) throw new OrderError("Choose a PNG or JPEG image.");
  const bytes=Buffer.from(match[2],"base64");
  const valid=match[1]==="png"
    ? bytes.length>24 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : bytes.length>4 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255 && bytes.at(-2)===255 && bytes.at(-1)===217;
  if (!valid || bytes.length>250*1024) throw new OrderError("Invalid image, or image exceeds 250 KB.");
  return data;
}
module.exports=function customerRouter(db) {
  const router=express.Router();
  router.use(authFor(db));
  router.get("/me",(req,res)=>res.json({user:accounts.publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id))}));
  const update=async(req,res)=>{
    try {res.json({message:"Profile changes saved.",...await accounts.updateProfile(db,req.user.id,req.body||{})});}
    catch(error) {sendError(res,error);}
  };
  router.put("/me",rateLimit(db,"profile",30,15),update);
  router.patch("/me/password",rateLimit(db,"password",10,15),async(req,res)=>{
    try {
      accounts.password(req.body?.newPassword);
      res.json({message:"Password changed. Other sessions have been signed out.",...await accounts.updateProfile(db,req.user.id,{
        currentPassword:req.body.currentPassword,newPassword:req.body.newPassword
      })});
    }catch(error){sendError(res,error);}
  });
  router.put("/me/avatar",(req,res)=>{
    try {
      const image=validateAvatar(req.body?.image);
      db.prepare("UPDATE users SET avatar_data=? WHERE id=?").run(image,req.user.id);
      res.json({message:"Profile photo saved.",avatar:image});
    }catch(error){sendError(res,error);}
  });
  router.delete("/me/avatar",(req,res)=>{
    db.prepare("UPDATE users SET avatar_data=NULL WHERE id=?").run(req.user.id);
    res.json({message:"Profile photo removed.",avatar:null});
  });
  router.post("/feedback",rateLimit(db,"feedback",5,5),(req,res)=>{
    try {
      const b=req.body||{},rating=Number(b.rating);
      if (!Number.isInteger(rating)||rating<1||rating>5) throw new OrderError("Choose a rating from 1 to 5.");
      const improve=accounts.field(b.improveComment,"improvement comment",2000,false,true);
      const liked=accounts.field(b.likedComment,"liked comment",2000,false,true);
      const frequency=accounts.field(b.visitFrequency,"visit frequency",250,false,true);
      const additional=accounts.field(b.additionalComment,"additional comment",2000,true,true);
      db.prepare("INSERT INTO feedback(user_id,rating,improve_comment,liked_comment,visit_frequency,additional_comment) VALUES(?,?,?,?,?,?)")
        .run(req.user.id,rating,improve,liked,frequency,additional);
      res.status(201).json({message:"Thank you for your feedback."});
    }catch(error){sendError(res,error);}
  });
  return router;
};
module.exports.validateAvatar=validateAvatar;
