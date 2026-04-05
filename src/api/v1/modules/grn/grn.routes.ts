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
    "grn.void",
    "grn.confirm.warehouse_manager",
    "inventory.emergency.override"
  )
);

// POST /api/v1/grn - Create GRN (draft)
router.post("/", controller.create);
// GET /api/v1/grn/pending-count — must be before GET /
router.get("/pending-count", controller.pendingCount);
// GET /api/v1/grn - List GRNs (org-scoped, newest first)
router.get("/", controller.list);
// GET /api/v1/grn/receive - avoid :id matching "receive"
// POST /api/v1/grn/:id/vendor-receive/submit — submit draft for manager confirmation (before POST receive)
router.post("/:id(\\d+)/vendor-receive/submit", controller.submitVendorReceive);
router.post("/:id(\\d+)/vendor-receive/draft", controller.saveVendorReceiveDraft);
// POST /api/v1/grn/:id/confirm — warehouse manager confirms and posts stock
router.post("/:id(\\d+)/confirm", controller.confirm);
// POST /api/v1/grn/:id/receive - Receive GRN (create ledger GRN_IN)
router.post("/:id/receive", controller.receive);
// POST /api/v1/grn/:id/void - Void draft GRN
router.post("/:id/void", controller.voidGrn);
// GET /api/v1/grn/:id/print/* — HTML print views (before /:id)
router.get("/:id(\\d+)/print/discrepancy", controller.printDiscrepancy);
router.get("/:id(\\d+)/print/worksheet", controller.printWorksheet);
router.get("/:id(\\d+)/print", controller.printHtml);
// GET /api/v1/grn/:id - Get by id
router.get("/:id", controller.getById);
// PATCH /api/v1/grn/:id - Update draft
router.patch("/:id", controller.update);

module.exports = router;
export {};
