const router = require("express").Router();
const optionalAuth = require("../middlewares/optionalAuth");
const { streamFileByKey } = require("../controllers/files.controller");

// Wildcard route to support keys with slashes
router.get("/files/*", optionalAuth, streamFileByKey);

module.exports = router;

export {};
