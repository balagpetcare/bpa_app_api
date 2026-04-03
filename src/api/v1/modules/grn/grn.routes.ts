const router = require("express").Router();
const controller = require("./grn.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");

router.use(authenticateToken);
router.use(
  requirePermission(
    "inbound.grn",
    "inbound.receive",
    "purchase.receive",
    "grn.view",
    "grn.create",
    "grn.post",
    "grn.void"
  )
);

// POST /api/v1/grn - Create GRN (draft)
router.post("/", controller.create);
// GET /api/v1/grn - List GRNs (org-scoped, newest first)
router.get("/", controller.list);
// GET /api/v1/grn/receive - avoid :id matching "receive"
// POST /api/v1/grn/:id/receive - Receive GRN (create ledger GRN_IN)
router.post("/:id/receive", controller.receive);
// POST /api/v1/grn/:id/void - Void draft GRN
router.post("/:id/void", controller.voidGrn);
// GET /api/v1/grn/:id - Get by id
router.get("/:id", controller.getById);
// PATCH /api/v1/grn/:id - Update draft
router.patch("/:id", controller.update);

module.exports = router;
export {};
