const router = require("express").Router();
const warehouseController = require("./warehouse.controller");
const warehouseReportsController = require("./warehouseReports.controller");
const warehouseOperationsController = require("./warehouseOperations.controller");
const warehouseAuditController = require("./warehouseAudit.controller");
const warehouseZoneController = require("../warehouse_zones/warehouseZone.controller");
const deliveryController = require("./delivery.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");

router.use(authenticateToken);

// ─── Warehouse CRUD ───────────────────────────────────────────────
router.post("/", warehouseController.create);
router.get("/accessible", warehouseController.listAccessible);
router.post("/ensure-default", warehouseController.ensureDefaultForOrg);
router.get("/", warehouseController.list);
router.get("/:id(\\d+)/reports/summary", warehouseReportsController.summary);
router.get("/:id(\\d+)/operations/summary", warehouseOperationsController.summary);
router.get("/:id(\\d+)/operations/dashboard", warehouseOperationsController.dashboard);
router.get("/:id(\\d+)/operations/inbound", warehouseOperationsController.inbound);
router.get("/:id(\\d+)/operations/requisitions", warehouseOperationsController.requisitions);
router.get("/:id(\\d+)/operations/outbound", warehouseOperationsController.outbound);
router.get("/:id(\\d+)/operations/discrepancies", warehouseOperationsController.discrepancies);
router.get("/:id(\\d+)/operations/visibility", warehouseOperationsController.visibility);
router.get("/:id(\\d+)/zones", warehouseZoneController.list);
router.post("/:id(\\d+)/zones", warehouseZoneController.create);
router.patch("/:id(\\d+)/zones/:zoneId(\\d+)", warehouseZoneController.update);
router.post("/:id(\\d+)/locations/zone", warehouseZoneController.setLocationZone);
router.get("/:id(\\d+)/audit/export.csv", warehouseAuditController.exportCsv);
router.get("/:id(\\d+)/dispatches", warehouseController.listDispatches);
router.get("/:id(\\d+)/delivery-assignments", warehouseController.listDeliveryAssignments);
router.get("/:id(\\d+)", warehouseController.getById);
router.patch("/:id(\\d+)", warehouseController.update);
router.get("/:id(\\d+)/dashboard", warehouseController.dashboard);

// ─── Staff Management ─────────────────────────────────────────────
router.get("/:id(\\d+)/staff/overview", warehouseController.getStaffOverview);
router.post("/:id(\\d+)/staff/invite", warehouseController.inviteStaff);
router.post("/:id(\\d+)/staff/invitations/:inviteId(\\d+)/resend", warehouseController.resendInvite);
router.post("/:id(\\d+)/staff/invitations/:inviteId(\\d+)/reinvite", warehouseController.reinvite);
router.post("/:id(\\d+)/staff/invitations/:inviteId(\\d+)/cancel", warehouseController.cancelInvite);
router.post("/:id(\\d+)/staff", warehouseController.addStaff);
router.get("/:id(\\d+)/staff", warehouseController.getStaff);
router.delete("/:id(\\d+)/staff/:assignmentId(\\d+)", warehouseController.removeStaff);

// ─── Location Linking ─────────────────────────────────────────────
router.post("/:id(\\d+)/locations/link", warehouseController.linkLocation);
router.post("/:id(\\d+)/locations/unlink", warehouseController.unlinkLocation);

// ─── Delivery Assignments ─────────────────────────────────────────
router.post("/dispatches/:dispatchId(\\d+)/assign-delivery", deliveryController.assignDelivery);
router.get("/delivery/assignments", deliveryController.myAssignments);
router.get("/delivery/assignments/:id(\\d+)", deliveryController.getAssignment);
router.post("/delivery/:id(\\d+)/start", deliveryController.startDelivery);
router.post("/delivery/:id(\\d+)/arrive", deliveryController.markArrived);
router.post("/delivery/:id(\\d+)/complete", deliveryController.completeDelivery);
router.post("/delivery/:id(\\d+)/fail", deliveryController.failDelivery);

module.exports = router;

export {};
