const router = require("express").Router();
const auth = require("./auth.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");
const { authLimiter } = require('../../../../middleware/rateLimiters');

router.get("/health", (req, res) =>
  res.json({ success: true, message: "Auth routes OK" })
);

router.post("/register", authLimiter, auth.register);
router.post("/login", authLimiter, auth.login);
router.get("/me", authenticateToken, auth.getProfile);

module.exports = router;
