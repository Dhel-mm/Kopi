const express=require("express");
const {authFor,requireRole}=require("../middleware/auth");
const {createReports,csv,reportCsv,summaryCsv}=require("../services/reports");
const {sendError}=require("../services/orderWorkflow");
const {OrderError}=require("../services/errors");
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
  // Every matching transaction for the full report preview and printout.
  router.get("/transactions/report",(req,res)=>{
    try {
      const {transactions,totals,timezone}=reports.transactions(req.query,true);
      res.json({transactions,totals,timezone,generatedAt:new Date().toISOString()});
    }catch(error){sendError(res,error);}
  });
  // format: csv (plain rows), report (summary + rows, the default) or json.
  router.get("/transactions/export",(req,res)=>{
    try {
      const format=req.query.format||"csv";
      if (!["csv","report","json"].includes(format)) throw new OrderError("Choose CSV, report or JSON.");
      const data=reports.transactions(req.query,true);
      if (format==="json") {
        return res.set("Content-Disposition",'attachment; filename="kopi-transactions.json"').type("application/json")
          .send(JSON.stringify({interval:req.query.label||"All time",generatedAt:new Date().toISOString(),timezone:data.timezone,
            totals:data.totals,transactions:data.transactions},null,2));
      }
      const name=format==="report"?"kopi-transaction-report.csv":"kopi-transactions.csv";
      res.set("Content-Disposition",`attachment; filename="${name}"`).type("text/csv")
        .send(format==="report"?reportCsv(data,typeof req.query.label==="string"?req.query.label.slice(0,80):""):csv(data.transactions));
    }catch(error){sendError(res,error);}
  });
  router.get("/feedback",(req,res)=>res.json({feedback:db.prepare(`SELECT f.id,f.rating,f.improve_comment AS improveComment,
    f.liked_comment AS likedComment,f.visit_frequency AS visitFrequency,f.additional_comment AS additionalComment,
    f.created_at AS createdAt,u.first_name||' '||u.last_name AS customer
    FROM feedback f JOIN users u ON u.id=f.user_id ORDER BY f.id DESC LIMIT 100`).all()}));
  return router;
};
