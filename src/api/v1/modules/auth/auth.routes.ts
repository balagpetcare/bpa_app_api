const router = require("express").Router();
const auth = require("./auth.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");
const { authLimiter } = require('../../../../middleware/rateLimiters');
const optionalAuth = require("../../../../middlewares/optionalAuth");
const producerVerify = require("../producer/producer.controller");

router.get("/health", (req, res) =>
  res.json({ success: true, message: "Auth routes OK" })
);

router.post("/register", authLimiter, auth.register);
router.post("/login", authLimiter, auth.login);

// Staff-specific login and context
router.post("/staff/login", authLimiter, auth.staffLogin);
router.get("/staff/context", authenticateToken, auth.getStaffContext);

// Staff invite based registration (public)
router.get("/invites/verify", authLimiter, auth.verifyInvite);
router.post("/invites/accept", authLimiter, optionalAuth, auth.acceptInvite);
router.post("/logout", auth.logout);
router.get("/me", authenticateToken, auth.getProfile);

// Public producer code verify
router.post("/verify", producerVerify.verify);

module.exports = router;

export {};
