const express = require("express");
const {authFor, requireRole} = require("../middleware/auth");
const {createVoucherService} = require("../services/vouchers");
const {sendError} = require("../services/orderWorkflow");

module.exports = function voucherRouter(db) {
  const router = express.Router();
  const vouchers = createVoucherService(db);
  router.use(authFor(db), requireRole("Admin"));
  router.get("/", (req, res) => res.json({vouchers: vouchers.list()}));
  router.post("/", (req, res) => {
    try { res.status(201).json({voucher: vouchers.save(req.body || {})}); }
    catch (error) { sendError(res, error); }
  });
  router.put("/:code", (req, res) => {
    try { res.json({voucher: vouchers.save(req.body || {}, req.params.code)}); }
    catch (error) { sendError(res, error); }
  });
  router.delete("/:code", (req, res) => {
    try { res.json(vouchers.remove(req.params.code)); }
    catch (error) { sendError(res, error); }
  });
  return router;
};
