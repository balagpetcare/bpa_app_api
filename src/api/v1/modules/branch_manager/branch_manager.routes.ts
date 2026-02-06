const router = require("express").Router();
const auth = require("../../../../middlewares/auth");
const ctrl = require("./branch_manager.controller");

// Robust resolver for CJS / ESM / ts-node exports
const listManagedBranches =
  typeof ctrl?.listManagedBranches === "function"
    ? ctrl.listManagedBranches
    : null;
const getKpis =
  typeof ctrl?.getKpis === "function" ? ctrl.getKpis : null;
const getStaffOverview =
  typeof ctrl?.getStaffOverview === "function"
    ? ctrl.getStaffOverview
    : null;

// List all branches that the current user manages
if (listManagedBranches) {
  router.get("/managed", auth, listManagedBranches);
}

// Branch-scoped manager endpoints
if (getKpis) {
  router.get("/:branchId/manager/kpis", auth, getKpis);
}

if (getStaffOverview) {
  router.get("/:branchId/manager/staff", auth, getStaffOverview);
}

module.exports = router;

export {};

