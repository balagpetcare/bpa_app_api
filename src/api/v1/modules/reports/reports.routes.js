const router = require("express").Router();
const reports = require("./reports.controller");
const auth = require("../../../../middleware/auth.middleware");

// Public: fetch reasons list for a given type
router.get("/reasons", reports.getReasons);

// Auth: create a report
router.post("/", auth, reports.createReport);

module.exports = router;
