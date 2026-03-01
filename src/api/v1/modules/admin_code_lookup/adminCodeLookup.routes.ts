/**
 * Admin Code Lookup – search by code/serial, view trace and verification history, block/unblock.
 * Base path: /api/v1/admin/code-lookup
 * Permission: admin.governance.code.search (read), admin.governance.enforcement.actions (block)
 */

const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");
const ctrl = require("./adminCodeLookup.controller");

const codeSearch = requirePermission("admin.governance.code.search");
const enforcementActions = requirePermission("admin.governance.enforcement.actions");

router.get("/", authenticateToken, requireAdmin, codeSearch, ctrl.lookup);
router.get("/history", authenticateToken, requireAdmin, codeSearch, ctrl.history);
router.post("/block", authenticateToken, requireAdmin, codeSearch, enforcementActions, ctrl.block);

module.exports = router;
export {};
