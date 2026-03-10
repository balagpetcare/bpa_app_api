/**
 * Vet reference routes: public read-only.
 * GET /api/v1/vet-reference/countries
 * GET /api/v1/vet-reference/countries/:code/bodies
 * GET /api/v1/vet-reference/bodies/:id/doc-types
 * GET /api/v1/vet-reference/bodies/:id (single body with country + doc types)
 */
const router = require("express").Router();
const ctrl = require("./vetReference.controller");

router.get("/countries", ctrl.listCountries);
router.get("/countries/:code/bodies", ctrl.getBodiesByCountryCode);
router.get("/bodies/:id/doc-types", ctrl.getDocTypesByBodyId);
router.get("/bodies/:id", ctrl.getBodyById);

module.exports = router;
