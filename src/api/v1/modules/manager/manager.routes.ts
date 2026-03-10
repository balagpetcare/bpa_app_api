/**
 * Manager API routes: dashboard, staff, reports, escalations.
 * Base path: /api/v1/manager
 * All routes require auth + manager access for the branch (requireManagerBranch).
 */

const router = require("express").Router();
const auth = require("../../../../middlewares/auth");
const { requireManagerBranch } = require("./manager.middleware");
const ctrl = require("./manager.controller");

router.use(auth);

router.get("/dashboard/:branchId", requireManagerBranch, ctrl.dashboard);
router.get("/staff/:branchId", requireManagerBranch, ctrl.staffList);
router.post("/staff/:branchId/assign", requireManagerBranch, ctrl.staffAssign);
router.put("/staff/:branchId/roster", requireManagerBranch, ctrl.rosterUpdate);
router.post("/staff/:branchId/leave", requireManagerBranch, ctrl.leaveApprove);

router.get("/reports/:branchId/daily", requireManagerBranch, ctrl.reportDaily);
router.get("/reports/:branchId/doctors", requireManagerBranch, ctrl.reportDoctors);
router.get("/reports/:branchId/inventory", requireManagerBranch, ctrl.reportInventory);

router.get("/escalations/:branchId", requireManagerBranch, ctrl.escalationsList);
router.post("/escalations/:branchId", requireManagerBranch, ctrl.escalationCreate);

module.exports = router;
