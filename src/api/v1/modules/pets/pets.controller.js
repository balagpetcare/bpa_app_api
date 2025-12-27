const prisma = require("../../../../infrastructure/db/prismaClient");

// ---------- helpers ----------
function toNullableString(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}
function toNullableInt(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function toNullableFloat(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function toBool(v, fallback = false) {
  if (v === true || v === "true" || v === 1 || v === "1") return true;
  if (v === false || v === "false" || v === 0 || v === "0") return false;
  return fallback;
}
function parseNullableDate(v) {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function handlePrismaUnique(res, e) {
  if (e && e.code === "P2002") {
    const targets = e.meta?.target || [];
    const arr = Array.isArray(targets) ? targets : [targets];
    if (arr.includes("microchipNumber")) {
      return res.status(409).json({
        success: false,
        message: "This microchip number is already used.",
        field: "microchipNumber",
      });
    }
  }
  return null;
}

// --------------------------------------------------
// GET /api/v1/user/pets/all or /api/v1/user/pets
// --------------------------------------------------
exports.getAllPets = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const pets = await prisma.pet.findMany({
      where: { userId: Number(userId), deleted: false },
      orderBy: { id: "desc" },
      include: {
        animalType: true,
        breed: true,
        profilePic: true,
        weights: { orderBy: { recordedAt: "desc" }, take: 1 }, // latest weight
      },
    });

    const data = pets.map((p) => ({
      ...p,
      id: Number(p.id),
      userId: Number(p.userId),
    }));

    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("getAllPets error:", e);
    return res.status(500).json({ success: false, message: e.message || "Server error" });
  }
};

// --------------------------------------------------
// POST /api/v1/user/pets/register OR /api/v1/user/pets
// --------------------------------------------------
exports.createPet = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const {
      name,
      animalTypeId,
      breedId,
      dateOfBirth,
      sex,
      microchipNumber,
      isRescue,
      isNeutered,
      foodHabits,
      healthDisorders,
      notes,
      profilePicId, // ✅ attach media id (optional)
      weightKg,     // ✅ initial weight (optional)
    } = req.body;

    if (!name || !animalTypeId || !sex) {
      return res.status(400).json({
        success: false,
        message: "name, animalTypeId and sex are required.",
      });
    }

    const data = {
      userId: Number(userId),
      name: String(name).trim(),
      animalTypeId: Number(animalTypeId),
      breedId: toNullableInt(breedId),
      dateOfBirth: parseNullableDate(dateOfBirth),
      sex: String(sex),
      microchipNumber: toNullableString(microchipNumber),
      isRescue: toBool(isRescue, false),
      isNeutered: toBool(isNeutered, false),
      foodHabits: toNullableString(foodHabits),
      healthDisorders: toNullableString(healthDisorders),
      notes: toNullableString(notes),
      profilePicId: toNullableInt(profilePicId),
    };

    // ✅ store weight in PetWeight table (NOT pet.weightKg)
    const w = toNullableFloat(weightKg);
    if (w !== null) {
      data.weights = { create: { weightKg: w, notes: "Initial weight" } };
    }

    const pet = await prisma.pet.create({
      data,
      include: {
        animalType: true,
        breed: true,
        profilePic: true,
        weights: { orderBy: { recordedAt: "desc" }, take: 1 },
      },
    });

    return res.status(201).json({
      success: true,
      data: { ...pet, id: Number(pet.id), userId: Number(pet.userId) },
    });
  } catch (e) {
    const handled = handlePrismaUnique(res, e);
    if (handled) return handled;
    console.error("createPet error:", e);
    return res.status(500).json({ success: false, message: e.message || "Server error" });
  }
};

// --------------------------------------------------
// PUT/PATCH /api/v1/user/pets/:id
// --------------------------------------------------
exports.updatePet = async (req, res) => {
  try {
    const userId = req.user?.id;
    const petId = Number(req.params.id);

    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!petId) return res.status(400).json({ success: false, message: "Invalid pet id" });

    const {
      name,
      animalTypeId,
      breedId,
      dateOfBirth,
      sex,
      microchipNumber,
      isRescue,
      isNeutered,
      foodHabits,
      healthDisorders,
      notes,
      profilePicId, // ✅ replace/attach
      weightKg,     // ✅ add new weight record
    } = req.body;

    const data = {};

    if (name !== undefined) data.name = String(name ?? "").trim();
    if (animalTypeId !== undefined) data.animalTypeId = Number(animalTypeId);
    if (breedId !== undefined) data.breedId = toNullableInt(breedId);
    if (dateOfBirth !== undefined) data.dateOfBirth = parseNullableDate(dateOfBirth);
    if (sex !== undefined) data.sex = String(sex ?? "UNKNOWN");

    if (microchipNumber !== undefined) data.microchipNumber = toNullableString(microchipNumber);
    if (isRescue !== undefined) data.isRescue = toBool(isRescue, false);
    if (isNeutered !== undefined) data.isNeutered = toBool(isNeutered, false);

    if (foodHabits !== undefined) data.foodHabits = toNullableString(foodHabits);
    if (healthDisorders !== undefined) data.healthDisorders = toNullableString(healthDisorders);
    if (notes !== undefined) data.notes = toNullableString(notes);

    if (profilePicId !== undefined) data.profilePicId = toNullableInt(profilePicId);

    // ✅ weight update -> create new PetWeight row
    const w = toNullableFloat(weightKg);
    if (weightKg !== undefined && w !== null) {
      data.weights = { create: { weightKg: w, notes: "Updated weight" } };
    }

    // ✅ IMPORTANT: updateMany for (id + userId) check
    const upd = await prisma.pet.updateMany({
      where: { id: petId, userId: Number(userId), deleted: false },
      data,
    });

    if (upd.count === 0) {
      return res.status(404).json({ success: false, message: "Pet not found" });
    }

    // return updated pet with relations
    const pet = await prisma.pet.findFirst({
      where: { id: petId, userId: Number(userId) },
      include: {
        animalType: true,
        breed: true,
        profilePic: true,
        weights: { orderBy: { recordedAt: "desc" }, take: 1 },
      },
    });

    return res.status(200).json({ success: true, data: pet });
  } catch (e) {
    const handled = handlePrismaUnique(res, e);
    if (handled) return handled;
    console.error("updatePet error:", e);
    return res.status(500).json({ success: false, message: e.message || "Server error" });
  }
};
