const express = require("express");
const router = express.Router();

// ✅ Import middleware correctly
const auth = require("../../middleware/authMiddleware");
// Support both exports: {authenticateToken} OR direct function
const authenticateToken = auth.authenticateToken || auth;

// ✅ Controllers
const petController = require("../../controllers/user/petController");
const mediaController = require("../../controllers/media/mediaController");

// ✅ Upload middleware
const upload = require("../../middleware/uploadMiddleware");

// 1. Pet Registration
router.post("/register", authenticateToken, petController.createPet);
router.patch("/:petId", authenticateToken, petController.updatePet);

// 2. Get All Pets List
router.get("/all", authenticateToken, petController.getAllPets);

// 3. Upload Pet Profile Picture
router.post(
  "/:petId/upload-photo",
  authenticateToken,
  upload.single("profile_pic"),
  mediaController.uploadPetProfileImage
);

module.exports = router;
