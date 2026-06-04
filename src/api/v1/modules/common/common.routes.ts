const router = require("express").Router();
const common = require("./common.controller");

// Animal taxonomy (enterprise)
router.get("/animal-categories", common.getAnimalCategories);
router.get("/animal-types", common.getAnimalTypes);
router.get("/animal-types/:id/breeds", common.getBreedsByType);
router.get("/breeds/:breedId/sub-breeds", common.getSubBreedsByBreed);
router.get("/breeds/:typeId", common.getBreedsByType);
router.get("/animal-colors", common.getAnimalColors);
router.get("/coat-patterns", common.getCoatPatterns);
router.get("/animal-sizes", common.getAnimalSizes);
// Bangladesh location dropdowns
router.get("/bd/divisions", common.getBdDivisions);
router.get("/bd/districts", common.getBdDistricts);
router.get("/bd/upazilas", common.getBdUpazilas);
router.get("/bd/unions", common.getBdUnions);
router.get("/bd/areas", common.getBdAreas);
router.get("/bd/city-corporations", common.getBdCityCorporations);
router.get("/bd/zones", common.getBdZones);
router.get("/bd/cc-areas", common.getBdCcAreas);
// Share link generator (public)
router.get("/share-link", common.getShareLink);

module.exports = router;

export {};
