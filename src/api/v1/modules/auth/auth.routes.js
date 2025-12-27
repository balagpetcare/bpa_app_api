const router = require("express").Router();
const auth = require("./auth.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");

router.get("/health", (req, res) =>
  res.json({ success: true, message: "Auth routes OK" })
);

router.post("/register", auth.register);
router.post("/login", auth.login);
router.get("/me", authenticateToken, auth.getProfile);

module.exports = router;
