const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");
const controller = require("./availability.controller");

const readAvailability = requirePermission(
  "inventory.view",
  "warehouse.allocation.manage",
  "warehouse.manage",
);

router.use(authenticateToken);

router.get("/multi-source", readAvailability, controller.getMultiSource);

module.exports = router;
export {};
