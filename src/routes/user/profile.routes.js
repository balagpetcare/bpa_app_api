const router = require("express").Router();
const { authenticateToken } = require("../../middleware/authMiddleware");
const profileController = require("../../controllers/user/profileController");

// GET /api/v1/profile/me
router.get("/me", authenticateToken, profileController.getMyProfile);

module.exports = router;
