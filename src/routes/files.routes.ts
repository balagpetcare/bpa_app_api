const router = require("express").Router();
const optionalAuth = require("../middlewares/optionalAuth");
const { streamFileByKey, optionsFileCors } = require("../controllers/files.controller");

// Preflight for cross-origin <img> / fetch from panels (e.g. owner 3104 -> API 3000)
router.options("/files/*", optionsFileCors);

// Wildcard route to support keys with slashes
router.get("/files/*", optionalAuth, streamFileByKey);

module.exports = router;

export {};
