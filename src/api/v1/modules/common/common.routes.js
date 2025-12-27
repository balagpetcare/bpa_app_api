const router = require("express").Router();
const common = require("./common.controller");

router.get("/animal-types", common.getAnimalTypes);
router.get("/breeds/:typeId", common.getBreedsByType);

module.exports = router;
