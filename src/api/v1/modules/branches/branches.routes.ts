const router = require("express").Router();
const auth = require('../../../../middlewares/auth');
const ctrl = require("./branches.controller");

// GET /api/v1/branches/:id/me - Branch-scoped me (branch + myAccess). Must be before /:id
router.get("/:id/me", auth, ctrl.getBranchMe);

// GET /api/v1/branches/:id - Get branch details (accessible by staff members or organization owners)
router.get("/:id", auth, ctrl.getBranch);

// GET /api/v1/branches/:branchId/members/invite-allowed-roles - Allowed roles for current user to invite (for dropdown).
router.get("/:branchId/members/invite-allowed-roles", auth, ctrl.getBranchInviteAllowedRoles);
// POST /api/v1/branches/:branchId/members/invite - Invite staff (owner or branch manager). Alias for owner panel flow.
router.post("/:branchId/members/invite", auth, ctrl.inviteBranchMember);

router.post("/:branchId/product-change-requests", auth, ctrl.createProductChangeRequest);

module.exports = router;

export {};
