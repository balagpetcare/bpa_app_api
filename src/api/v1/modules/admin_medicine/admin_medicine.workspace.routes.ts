const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const adminOnly = require("../../../../middleware/admin.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");
const ctrl = require("./admin_medicine.workspace.controller");

const medRead = requirePermission(
  "medicine.master.read",
  "medicine.master.write",
  "medicine.catalog.import",
  "medicine.catalog.export",
  "medicine.catalog.review",
  "medicine.catalog.listing.manage",
  "medicine.catalog.governance"
);
const medWrite = requirePermission("medicine.master.write", "medicine.catalog.listing.manage", "medicine.catalog.governance");
const medExport = requirePermission("medicine.catalog.export", "medicine.master.write", "medicine.catalog.governance");

router.get("/countries", authenticateToken, adminOnly, medRead, ctrl.countries);
router.get("/audit-logs", authenticateToken, adminOnly, medRead, ctrl.auditLogs);
router.get("/dashboard/summary", authenticateToken, adminOnly, medRead, ctrl.dashboardSummary);
router.get("/review/queues", authenticateToken, adminOnly, medRead, ctrl.reviewQueues);
router.get("/exports/listings.csv", authenticateToken, adminOnly, medExport, ctrl.exportListingsCsv);
router.get("/settings/meta", authenticateToken, adminOnly, medRead, ctrl.settingsMeta);

router.get("/listings", authenticateToken, adminOnly, medRead, ctrl.listingsList);
router.post("/listings", authenticateToken, adminOnly, medWrite, ctrl.listingsCreate);
router.post("/listings/bulk", authenticateToken, adminOnly, medWrite, ctrl.listingsBulk);
router.post("/listings/preview", authenticateToken, adminOnly, medRead, ctrl.listingsPreview);
router.get("/listings/:id", authenticateToken, adminOnly, medRead, ctrl.listingsGet);
router.patch("/listings/:id", authenticateToken, adminOnly, medWrite, ctrl.listingsPatch);
router.post("/listings/:id/archive", authenticateToken, adminOnly, medWrite, ctrl.listingsArchive);
router.post("/listings/:id/restore", authenticateToken, adminOnly, medWrite, ctrl.listingsRestore);

router.get("/generics", authenticateToken, adminOnly, medRead, ctrl.genericsList);
router.get("/generics/:id", authenticateToken, adminOnly, medRead, ctrl.genericsGet);
router.post("/generics", authenticateToken, adminOnly, medWrite, ctrl.genericsCreate);
router.patch("/generics/:id", authenticateToken, adminOnly, medWrite, ctrl.genericsPatch);
router.post("/generics/:id/archive", authenticateToken, adminOnly, medWrite, ctrl.genericsArchive);

router.get("/dosage-forms", authenticateToken, adminOnly, medRead, ctrl.dosageFormsList);
router.get("/dosage-forms/:id", authenticateToken, adminOnly, medRead, ctrl.dosageFormsGet);
router.post("/dosage-forms", authenticateToken, adminOnly, medWrite, ctrl.dosageFormsCreate);
router.patch("/dosage-forms/:id", authenticateToken, adminOnly, medWrite, ctrl.dosageFormsPatch);
router.post("/dosage-forms/:id/archive", authenticateToken, adminOnly, medWrite, ctrl.dosageFormsArchive);

router.get("/manufacturers", authenticateToken, adminOnly, medRead, ctrl.manufacturersList);
router.get("/manufacturers/:id", authenticateToken, adminOnly, medRead, ctrl.manufacturersGet);
router.post("/manufacturers", authenticateToken, adminOnly, medWrite, ctrl.manufacturersCreate);
router.patch("/manufacturers/:id", authenticateToken, adminOnly, medWrite, ctrl.manufacturersPatch);
router.post("/manufacturers/:id/archive", authenticateToken, adminOnly, medWrite, ctrl.manufacturersArchive);

router.get("/brands", authenticateToken, adminOnly, medRead, ctrl.brandsList);
router.get("/brands/:id", authenticateToken, adminOnly, medRead, ctrl.brandsGet);
router.post("/brands", authenticateToken, adminOnly, medWrite, ctrl.brandsCreate);
router.patch("/brands/:id", authenticateToken, adminOnly, medWrite, ctrl.brandsPatch);
router.post("/brands/:id/archive", authenticateToken, adminOnly, medWrite, ctrl.brandsArchive);

router.get("/presentations", authenticateToken, adminOnly, medRead, ctrl.presentationsList);
router.get("/presentations/:id", authenticateToken, adminOnly, medRead, ctrl.presentationsGet);
router.post("/presentations", authenticateToken, adminOnly, medWrite, ctrl.presentationsCreate);
router.patch("/presentations/:id", authenticateToken, adminOnly, medWrite, ctrl.presentationsPatch);
router.post("/presentations/:id/archive", authenticateToken, adminOnly, medWrite, ctrl.presentationsArchive);

router.get("/country-catalogs/:countryId/summary", authenticateToken, adminOnly, medRead, ctrl.countryCatalogSummary);

module.exports = router;
export {};
