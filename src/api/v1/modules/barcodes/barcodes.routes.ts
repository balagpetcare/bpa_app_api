const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const controller = require("./barcodes.controller");
const { requireBranchBarcodeAccess, requireBranchLabelMutate } = require("./barcodes.middleware");

router.use(authenticateToken);

router.get("/branch-lots", requireBranchBarcodeAccess, controller.listBranchLots);
router.get("/branch-variants", requireBranchBarcodeAccess, controller.listBranchVariants);
router.get("/resolve", requireBranchBarcodeAccess, controller.resolve);
router.get("/labels/product/:variantId", requireBranchBarcodeAccess, controller.getProductLabel);
router.get("/labels/batch/:lotId", requireBranchBarcodeAccess, controller.getBatchLabel);
router.post("/labels/bulk", requireBranchBarcodeAccess, controller.bulkLabels);
router.patch("/lots/:lotId/label-barcode", requireBranchLabelMutate, controller.patchLotLabelBarcode);

module.exports = router;
