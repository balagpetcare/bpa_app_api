const router = require("express").Router();

// ✅ path ঠিক: routes/common -> controllers/common
const commonController = require("../../controllers/common/controller.js");

// GET /api/v1/common/animal-types
router.get("/animal-types", commonController.getAnimalTypes);

// GET /api/v1/common/breeds/:typeId
router.get("/breeds/:typeId", commonController.getBreedsByType);

module.exports = router;
