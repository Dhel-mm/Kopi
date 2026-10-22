const express=require("express");
const {authFor,requireRole}=require("../middleware/auth");
const {createReports,csv,summaryCsv}=require("../services/reports");
const {sendError}=require("../services/orderWorkflow");
module.exports=function reportsRouter(db,clock) {
  const router=express.Router(),reports=createReports(db,clock);
  router.use(authFor(db),requireRole("Admin"));
  router.get("/dashboard",(req,res)=>{
    try {res.json(reports.dashboard(req.query));}catch(error){sendError(res,error);}
  });
  router.get("/reports/summary",(req,res)=>{
    try {res.json(reports.salesSummary(req.query));}catch(error){sendError(res,error);}
  });
  router.get("/reports/summary/export",(req,res)=>{
    try {
      const data=reports.salesSummary(req.query);
      const name=`kopi-sales-${["day","week"].includes(data.period)?data.start:data.period==="year"?data.start.slice(0,4):data.start.slice(0,7)}.csv`;
      res.set("Content-Disposition",`attachment; filename="${name}"`).type("text/csv").send(summaryCsv(data));
    }catch(error){sendError(res,error);}
  });
  router.get("/transactions",(req,res)=>{
    try {res.json(reports.transactions(req.query));}catch(error){sendError(res,error);}
  });
  router.get("/transactions/export",(req,res)=>{
    try {
      const data=reports.transactions(req.query,true);
      res.set("Content-Disposition",'attachment; filename="kopi-transactions.csv"').type("text/csv").send(csv(data.transactions));
    }catch(error){sendError(res,error);}
  });
  router.get("/feedback",(req,res)=>res.json({feedback:db.prepare(`SELECT f.id,f.rating,f.improve_comment AS improveComment,
    f.liked_comment AS likedComment,f.visit_frequency AS visitFrequency,f.additional_comment AS additionalComment,
    f.created_at AS createdAt,u.first_name||' '||u.last_name AS customer
    FROM feedback f JOIN users u ON u.id=f.user_id ORDER BY f.id DESC LIMIT 100`).all()}));
  return router;
};
