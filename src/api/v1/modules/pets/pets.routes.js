const router = require("express").Router();
const auth = require("../../../../middleware/auth.middleware");
const pets = require("./pets.controller");

// ✅ GET
router.get("/all", auth, pets.getAllPets);
router.get("/", auth, pets.getAllPets);

// ✅ GET single pet + profile aggregation (for Pet Profile screen)
router.get("/:id/profile", auth, pets.getPetProfile);
router.get("/:id", auth, pets.getPetById);

// ✅ POST (two paths)
router.post("/register", auth, pets.createPet); // ✅ আপনার ক্লায়েন্ট এটা কল করছে
router.post("/", auth, pets.createPet);         // ✅ standard

// ✅ PUT
router.put("/:id", auth, pets.updatePet);
router.patch("/:id", auth, pets.updatePet);

// ✅ DELETE (soft delete)
router.delete("/:id", auth, pets.deletePet);

module.exports = router;
