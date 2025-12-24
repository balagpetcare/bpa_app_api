const express = require("express");
const router = express.Router();

const auth = require("../../middleware/authMiddleware");
const authenticateToken = auth.authenticateToken || auth;

const authController = require("../../controllers/user/authController");

console.log("authenticateToken type:", typeof authenticateToken);
console.log("authController keys:", Object.keys(authController || {}));

// Health
router.get("/health", (req, res) =>
  res.json({ success: true, message: "Auth routes OK" })
);

// Register
router.post("/register", authController.register);

// Login
router.post("/login", authController.login);

// ✅ Your controller has getProfile, so use it
router.get("/me", authenticateToken, authController.getProfile);

module.exports = router;
