const express = require("express");
const {authFor, requireRole} = require("../middleware/auth");
const {sendError} = require("../services/orderWorkflow");
const {OrderError} = require("../services/pricing");
const {createIdRegistry} = require("../services/idRegistry");

// Simulated OSCA / NCDA registry check, used only by the in-store POS (cashier).
// Online customers upload a photo of the ID instead, which staff verify.
module.exports = function idRegistryRouter(db) {
  const router = express.Router();
  const registry = createIdRegistry(db);
  router.use(authFor(db), requireRole("Admin", "Cashier"));
  router.get("/verify", (req, res) => {
    try {
      const {type, idNumber, name} = req.query;
      if (!["Senior Citizen", "PWD"].includes(type)) throw new OrderError("Choose Senior Citizen or PWD.");
      res.json({verified: true, record: registry.verify({type, idNumber, name})});
    } catch (error) {sendError(res, error);}
  });
  return router;
};
