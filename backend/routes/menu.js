const express = require("express");
const { authFor, requireRole } = require("../middleware/auth");
const { sendError } = require("../services/orderWorkflow");
const { createMenuService } = require("../services/menu");

// Menu Management: the administrator adds, edits, hides and archives menu items.
module.exports = function menuRouter(db) {
  const router = express.Router();
  const menu = createMenuService(db);
  router.use(authFor(db), requireRole("Admin"));
  router.get("/", (req, res) => res.json(menu.list()));
  router.post("/products", (req, res) => {
    try { res.status(201).json({ product: menu.create(req.body || {}, req.user) }); }
    catch (error) { sendError(res, error); }
  });
  router.put("/products/:id", (req, res) => {
    try { res.json({ product: menu.update(req.params.id, req.body || {}, req.user) }); }
    catch (error) { sendError(res, error); }
  });
  router.patch("/products/:id/availability", (req, res) => {
    try { res.json(menu.setAvailable(req.params.id, req.body?.available, req.user)); }
    catch (error) { sendError(res, error); }
  });
  router.patch("/products/:id/archive", (req, res) => {
    try { res.json(menu.archive(req.params.id, req.body?.archived, req.user)); }
    catch (error) { sendError(res, error); }
  });
  return router;
};
