const router = require("express").Router();
const auth = require('../../../../middlewares/auth');
const ctrl = require("./branches.controller");

// GET /api/v1/branches/:id/me - Branch-scoped me (branch + myAccess). Must be before /:id
router.get("/:id/me", auth, ctrl.getBranchMe);

// GET /api/v1/branches/:id - Get branch details (accessible by staff members or organization owners)
router.get("/:id", auth, ctrl.getBranch);

router.post("/:branchId/product-change-requests", auth, ctrl.createProductChangeRequest);

module.exports = router;

export {};
