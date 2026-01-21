const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const adminOnly = require("../../../../middleware/admin.middleware");
const ctrl = require("./admin_verification_cases.controller");

// List / filter cases
router.get("/", authenticateToken, adminOnly, ctrl.listCases);

// Get single case (with docs + events)
router.get("/:id", authenticateToken, adminOnly, ctrl.getCase);

// Per-document review
router.patch("/documents/:id", authenticateToken, adminOnly, ctrl.patchDocument);

// Case-level decision (approve / reject)
router.post("/:id/decision", authenticateToken, adminOnly, ctrl.decideCase);

module.exports = router;

export {};
