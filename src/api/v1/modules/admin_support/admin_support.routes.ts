/**
 * Admin support tickets. Base path: /api/v1/admin/support/tickets
 * RBAC: admin.support.tickets.manage (list, stats, detail, update, internal-notes, escalate), admin.support.tickets.respond (reply).
 */

const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");
const governanceTrace = require("../../middlewares/governanceTrace.middleware");
const ctrl = require("./admin_support.controller");

const manage = requirePermission("admin.support.tickets.manage");
const respond = requirePermission("admin.support.tickets.respond");
const escalate = requirePermission("admin.support.tickets.escalate");

router.use(governanceTrace);

router.get("/stats", authenticateToken, requireAdmin, manage, ctrl.stats);
router.get("/", authenticateToken, requireAdmin, manage, ctrl.list);
router.get("/:id", authenticateToken, requireAdmin, manage, ctrl.getOne);
router.patch("/:id", authenticateToken, requireAdmin, manage, ctrl.update);
router.post("/:id/messages", authenticateToken, requireAdmin, respond, ctrl.reply);
router.post("/:id/internal-notes", authenticateToken, requireAdmin, manage, ctrl.addInternalNote);
router.post("/:id/escalate", authenticateToken, requireAdmin, escalate, ctrl.escalate);

module.exports = router;
export {};
