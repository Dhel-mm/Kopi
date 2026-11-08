const express = require("express");
const {authFor, requireRole} = require("../middleware/auth");
const {createActivityReader} = require("../services/activityLog");
const {sendError} = require("../services/orderWorkflow");

// Records of user movements, for the owner only.
module.exports = function activityRouter(db) {
  const router = express.Router();
  const reader = createActivityReader(db);
  router.use(authFor(db), requireRole("Admin"));
  router.get("/", (req, res) => {
    try { res.json(reader.list(req.query)); }
    catch (error) { sendError(res, error); }
  });
  return router;
};
