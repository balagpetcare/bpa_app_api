const router = require("express").Router();
const common = require("./common.controller");

router.get("/animal-types", common.getAnimalTypes);
router.get("/breeds/:typeId", common.getBreedsByType);
// Bangladesh location dropdowns
router.get("/bd/divisions", common.getBdDivisions);
router.get("/bd/districts", common.getBdDistricts);
router.get("/bd/upazilas", common.getBdUpazilas);
router.get("/bd/areas", common.getBdAreas);
router.get("/bd/city-corporations", common.getBdCityCorporations);
router.get("/bd/zones", common.getBdZones);
router.get("/bd/cc-areas", common.getBdCcAreas);
// Share link generator (public)
router.get("/share-link", common.getShareLink);

module.exports = router;
