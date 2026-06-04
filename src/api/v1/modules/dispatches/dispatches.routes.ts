const router = require("express").Router();
const controller = require("./dispatches.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");

router.use(authenticateToken);

router.get("/", controller.listDispatches);
router.get("/incoming", controller.getIncomingDispatches);
router.post("/", controller.createDispatch);
router.get("/:id(\\d+)/print/challan", controller.printDispatchChallan);
router.get("/:id(\\d+)/print/delivery-note", controller.printDeliveryNoteCarrier);
router.get("/:id(\\d+)/print/branch-receiving-record", controller.printBranchReceivingRecord);
router.get("/:id(\\d+)/print/branch-confirmation", controller.printBranchReceiveConfirmation);
router.get("/:id(\\d+)/print/discrepancy", controller.printDispatchDiscrepancyReport);
router.get("/:id(\\d+)/print/branch-worksheet", controller.printBranchReceiveWorksheet);
router.get("/:id(\\d+)/discrepancies", controller.listDispatchDiscrepancies);
router.post("/:id(\\d+)/discrepancies", controller.createDispatchDiscrepancy);
router.patch("/discrepancies/:discrepancyId(\\d+)/resolve", controller.resolveDispatchDiscrepancy);
router.get("/:id(\\d+)/receive-session", controller.getDispatchReceiveSession);
router.put("/:id(\\d+)/receive-session", controller.putDispatchReceiveSession);
router.post("/:id(\\d+)/receive-session/submit", controller.postDispatchReceiveSessionSubmit);
router.post("/:id(\\d+)/receive-session/confirm", controller.postDispatchReceiveSessionConfirm);
router.post("/:id(\\d+)/receive-session/cancel", controller.postDispatchReceiveSessionCancel);
router.get("/:id(\\d+)", controller.getDispatch);
router.post("/:id/status", controller.updateStatus);
router.post("/:id/send", controller.sendDispatch);
router.post("/:id/receive", controller.receiveDispatch);

module.exports = router;

export {};
