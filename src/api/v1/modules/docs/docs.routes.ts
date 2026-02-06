const router = require("express").Router();
const docsController = require("./docs.controller");

// Public (admin panel will call with same-origin cookie; no auth required for docs)
router.get("/list", docsController.listDocs);
router.get("/:slug", docsController.getDoc);

module.exports = router;
