const router = require("express").Router();
const ctrl = require("./batches.controller");
const auth = require("../../../../middleware/auth.middleware");

router.use(auth);

// GET /api/v1/batches - list batches
router.get("/", ctrl.listBatches);

// POST /api/v1/batches - request batch
router.post("/", ctrl.createBatch);

// POST /api/v1/batches/:id/approve - approve batch (admin/compliance)
router.post("/:id/approve", ctrl.approveBatch);

// POST /api/v1/batches/:id/issue-serials - issue serials from approved batch
router.post("/:id/issue-serials", ctrl.issueSerials);

module.exports = router;
export {};
