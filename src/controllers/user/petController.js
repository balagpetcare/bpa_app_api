const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/**
 * POST /api/v1/pets/register
 * REQUIRED: name, sex, animalTypeId, breedId
 */
const createPet = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { name, sex, animalTypeId, breedId } = req.body;

    // ✅ required validation
    if (!name || !sex || !animalTypeId || !breedId) {
      return res.status(400).json({
        success: false,
        message: "name, sex, animalTypeId, breedId are required",
      });
    }

    const animalTypeIdNum = Number(animalTypeId);
    const breedIdNum = Number(breedId);

    if (Number.isNaN(animalTypeIdNum) || Number.isNaN(breedIdNum)) {
      return res.status(400).json({
        success: false,
        message: "Invalid animalTypeId or breedId",
      });
    }

    // ✅ animal type exists
    const typeExists = await prisma.animalType.findUnique({
      where: { id: animalTypeIdNum },
      select: { id: true, name: true },
    });

    if (!typeExists) {
      return res.status(404).json({
        success: false,
        message: "Animal type not found",
      });
    }

    // ✅ breed must belong to that type
    const breedExists = await prisma.breed.findFirst({
      where: { id: breedIdNum, animalTypeId: animalTypeIdNum },
      select: { id: true, name: true },
    });

    if (!breedExists) {
      return res.status(400).json({
        success: false,
        message: "Selected breed does not belong to selected animal type",
      });
    }

    // ✅ create pet
    const pet = await prisma.pet.create({
      data: {
        userId,
        name: String(name).trim(),
        sex: String(sex).trim(), // Gender enum হলে prisma auto validate করবে
        animalTypeId: animalTypeIdNum,
        breedId: breedIdNum,
      },
      select: {
        id: true,
        name: true,
        sex: true,
        animalTypeId: true,
        breedId: true,
        profilePicId: true,
        createdAt: true,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Pet registered successfully",
      data: { pet },
    });
  } catch (error) {
    console.error("createPet error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

/**
 * PATCH /api/v1/pets/:petId
 * Step-3: extra details update (optional fields)
 */
const updatePet = async (req, res) => {
  try {
    const userId = req.user?.id;
    const petId = Number(req.params.petId);

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (!petId || Number.isNaN(petId)) {
      return res.status(400).json({ success: false, message: "Invalid petId" });
    }

    // ✅ ownership check
    const petExists = await prisma.pet.findFirst({
      where: { id: petId, userId },
      select: { id: true },
    });

    if (!petExists) {
      return res.status(404).json({ success: false, message: "Pet not found" });
    }

    const {
      dateOfBirth, // "YYYY-MM-DD"
      weightKg,
      microchipNumber,
      isRescue,
      isNeutered,
      foodHabits,
      healthDisorders,
      notes,
    } = req.body;

    const data = {};

    if (dateOfBirth !== undefined) {
      data.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
    }
    if (weightKg !== undefined) {
      data.weightKg = weightKg === null ? null : Number(weightKg);
    }
    if (microchipNumber !== undefined) {
      data.microchipNumber = microchipNumber || null;
    }
    if (isRescue !== undefined) {
      data.isRescue = Boolean(isRescue);
    }
    if (isNeutered !== undefined) {
      data.isNeutered = Boolean(isNeutered);
    }
    if (foodHabits !== undefined) {
      data.foodHabits = foodHabits || null;
    }
    if (healthDisorders !== undefined) {
      data.healthDisorders = healthDisorders || null;
    }
    if (notes !== undefined) {
      data.notes = notes || null;
    }

    // যদি কিছুই পাঠানো না হয়
    if (Object.keys(data).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields provided to update",
      });
    }

    const updated = await prisma.pet.update({
      where: { id: petId },
      data,
      select: {
        id: true,
        name: true,
        sex: true,
        animalTypeId: true,
        breedId: true,
        profilePicId: true,
        dateOfBirth: true,
        microchipNumber: true,
        isRescue: true,
        isNeutered: true,
        foodHabits: true,
        healthDisorders: true,
        notes: true,
        updatedAt: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Pet updated successfully",
      data: { pet: updated },
    });
  } catch (error) {
    console.error("updatePet error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

/**
 * GET /api/v1/pets/all
 * Current user's pets list
 */
const getAllPets = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const pets = await prisma.pet.findMany({
      where: { userId, deleted: false },
      orderBy: { id: "desc" },
      select: {
        id: true,
        name: true,
        sex: true,
        animalTypeId: true,
        breedId: true,
        profilePicId: true,
        createdAt: true,
      },
    });

    return res.status(200).json({
      success: true,
      pets,
    });
  } catch (error) {
    console.error("getAllPets error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

module.exports = {
  createPet,
  updatePet,
  getAllPets,
};
