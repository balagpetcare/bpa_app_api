const router = require("express").Router();
const ctrl = require("./factories.controller");
const auth = require("../../../../middleware/auth.middleware");

router.use(auth);

// GET /api/v1/factories
router.get("/", ctrl.listFactories);
// POST /api/v1/factories
router.post("/", ctrl.createFactory);

// GET /api/v1/factories/:id/lines
router.get("/:id/lines", ctrl.listLines);
// POST /api/v1/factories/:id/lines
router.post("/:id/lines", ctrl.createLine);

module.exports = router;
export {};
