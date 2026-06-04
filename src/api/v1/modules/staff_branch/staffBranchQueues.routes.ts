const router = require("express").Router();
const auth = require("../../../../middlewares/auth");
const ctrl = require("./staffBranchQueues.controller");

router.get("/branch/:branchId/inbound-queue", auth, ctrl.getInboundQueue);

module.exports = router;
export {};
