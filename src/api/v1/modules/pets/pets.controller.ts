import { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";
import { Gender } from "@prisma/client";

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
function parseGender(v: any): Gender | null {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  return Object.values(Gender).includes(s as Gender)
    ? (s as Gender)
    : null;
}

function handlePrismaUnique(res, e) {
  if (e && e.code === "P2002") {
    const targets = e.meta?.target || [];
    const arr = Array.isArray(targets) ? targets : [targets];
    if (arr.includes("microchipNumber")) {
      return res.status(409).json({
        success: false,
        code: "DUPLICATE_PET",
        message: "This microchip number is already used.",
        field: "microchipNumber",
      });
    }
    if (arr.includes("uniquePetId")) {
      return res.status(409).json({
        success: false,
        code: "DUPLICATE_PET",
        message: "Pet ID collision; please retry.",
      });
    }
  }
  return null;
}

async function resolveTaxonomySnapshots(p: {
  animalTypeId: number;
  breedId?: number | null;
  subBreedId?: number | null;
  colorId?: number | null;
  coatPatternId?: number | null;
  sizeId?: number | null;
  customBreedText?: string | null;
  customColorText?: string | null;
}) {
  const [animalType, breed, subBreed, color, coatPattern, size] = await Promise.all([
    p.animalTypeId ? prisma.animalType.findUnique({ where: { id: p.animalTypeId }, select: { name: true } }) : null,
    p.breedId ? prisma.breed.findUnique({ where: { id: p.breedId }, select: { name: true } }) : null,
    p.subBreedId ? prisma.subBreed.findUnique({ where: { id: p.subBreedId }, select: { name: true } }) : null,
    p.colorId ? prisma.animalColor.findUnique({ where: { id: p.colorId }, select: { name: true } }) : null,
    p.coatPatternId ? prisma.coatPattern.findUnique({ where: { id: p.coatPatternId }, select: { name: true } }) : null,
    p.sizeId ? prisma.animalSize.findUnique({ where: { id: p.sizeId }, select: { name: true } }) : null,
  ]);
  return {
    animalTypeNameSnapshot: animalType?.name ?? null,
    breedNameSnapshot: (p.customBreedText?.trim() || breed?.name) ?? null,
    subBreedNameSnapshot: subBreed?.name ?? null,
    colorNameSnapshot: (p.customColorText?.trim() || color?.name) ?? null,
    coatPatternNameSnapshot: coatPattern?.name ?? null,
    sizeNameSnapshot: size?.name ?? null,
  };
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
        subBreed: true,
        color: true,
        coatPattern: true,
        size: true,
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

// Canonical Pet model: same uniquePetId pattern as clinic; userId = req.user.id only.
function generateUniquePetId() {
  const hex = require("crypto").randomBytes(6).toString("hex").toUpperCase();
  return `PET-${hex}`;
}

// --------------------------------------------------
// POST /api/v1/user/pets/register OR /api/v1/user/pets
// --------------------------------------------------
exports.createPet = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const {
      name,
      animalTypeId,
      breedId,
      subBreedId,
      colorId,
      coatPatternId,
      sizeId,
      customBreedText,
      customColorText,
      dateOfBirth,
      sex,
      microchipNumber,
      isRescue,
      isNeutered,
      foodHabits,
      healthDisorders,
      notes,
      profilePicId,
      weightKg, // accepted but stored separately
    } = req.body || {};

    if (!name || !animalTypeId || !sex) {
      return res.status(400).json({
        success: false,
        message: "name, animalTypeId and sex are required",
      });
    }

    const microchip = toNullableString(microchipNumber);
    if (microchip) {
      const existing = await prisma.pet.findFirst({
        where: { microchipNumber: microchip, deleted: false },
        select: { id: true },
      });
      if (existing) {
        return res.status(409).json({
          success: false,
          code: "DUPLICATE_PET",
          message: "This microchip number is already used.",
          field: "microchipNumber",
        });
      }
    }

    const gender = parseGender(sex);
    if (!gender) {
      return res.status(400).json({
        success: false,
        message: "Invalid sex. Allowed values: MALE, FEMALE",
      });
    }

    const snapshots = await resolveTaxonomySnapshots({
      animalTypeId: Number(animalTypeId),
      breedId: toNullableInt(breedId),
      subBreedId: toNullableInt(subBreedId),
      colorId: toNullableInt(colorId),
      coatPatternId: toNullableInt(coatPatternId),
      sizeId: toNullableInt(sizeId),
      customBreedText: toNullableString(customBreedText),
      customColorText: toNullableString(customColorText),
    });

    const uniquePetId = generateUniquePetId();
    const pet = await prisma.pet.create({
      data: {
        name: String(name).trim(),
        sex: gender,
        dateOfBirth: parseNullableDate(dateOfBirth),
        microchipNumber: microchip ?? null,
        uniquePetId,
        isRescue: toBool(isRescue, false),
        isNeutered: toBool(isNeutered, false),
        foodHabits: toNullableString(foodHabits),
        healthDisorders: toNullableString(healthDisorders),
        notes: toNullableString(notes),
        animalTypeNameSnapshot: snapshots.animalTypeNameSnapshot,
        breedNameSnapshot: snapshots.breedNameSnapshot,
        subBreedNameSnapshot: snapshots.subBreedNameSnapshot,
        colorNameSnapshot: snapshots.colorNameSnapshot,
        coatPatternNameSnapshot: snapshots.coatPatternNameSnapshot,
        sizeNameSnapshot: snapshots.sizeNameSnapshot,
        customBreedText: toNullableString(customBreedText),
        customColorText: toNullableString(customColorText),

        user: { connect: { id: Number(userId) } },
        animalType: { connect: { id: Number(animalTypeId) } },
        ...(breedId ? { breed: { connect: { id: Number(breedId) } } } : {}),
        ...(subBreedId ? { subBreed: { connect: { id: Number(subBreedId) } } } : {}),
        ...(colorId ? { color: { connect: { id: Number(colorId) } } } : {}),
        ...(coatPatternId ? { coatPattern: { connect: { id: Number(coatPatternId) } } } : {}),
        ...(sizeId ? { size: { connect: { id: Number(sizeId) } } } : {}),
        ...(profilePicId
          ? { profilePic: { connect: { id: Number(profilePicId) } } }
          : {}),
      },
    });

    // -------------------------
    // 2️⃣ Store initial weight (OPTIONAL, separate table)
    // -------------------------
    const w = toNullableFloat(weightKg);
    if (w !== null) {
      await prisma.petWeight.create({
        data: {
          petId: pet.id,
          weightKg: w,
          notes: "Initial weight",
        },
      });
    }

    // -------------------------
    // 3️⃣ Reload pet with relations
    // -------------------------
    const fullPet = await prisma.pet.findUnique({
      where: { id: pet.id },
      include: {
        animalType: true,
        breed: true,
        subBreed: true,
        color: true,
        coatPattern: true,
        size: true,
        profilePic: true,
        weights: { orderBy: { recordedAt: "desc" }, take: 1 },
      },
    });

    return res.status(201).json({
      success: true,
      data: fullPet,
    });
  } catch (e) {
    const handled = handlePrismaUnique(res, e);
    if (handled) return handled;

    console.error("createPet error:", e);
    return res.status(500).json({
      success: false,
      message: e?.message || "Server error",
    });
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
      subBreedId,
      colorId,
      coatPatternId,
      sizeId,
      customBreedText,
      customColorText,
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

    const data: Prisma.PetUpdateInput = {};

    if (name !== undefined) data.name = String(name ?? "").trim();
    if (dateOfBirth !== undefined) data.dateOfBirth = parseNullableDate(dateOfBirth);

    // ✅ enum-safe sex
    if (sex !== undefined) {
      const g = parseGender(sex);
      if (!g) {
        return res.status(400).json({
          success: false,
          message: "Invalid sex. Allowed values: MALE, FEMALE",
        });
      }
      data.sex = g;
    }

    if (microchipNumber !== undefined) data.microchipNumber = toNullableString(microchipNumber);
    if (isRescue !== undefined) data.isRescue = toBool(isRescue, false);
    if (isNeutered !== undefined) data.isNeutered = toBool(isNeutered, false);

    if (foodHabits !== undefined) data.foodHabits = toNullableString(foodHabits);
    if (healthDisorders !== undefined) data.healthDisorders = toNullableString(healthDisorders);
    if (notes !== undefined) data.notes = toNullableString(notes);

    // ✅ relations
    if (animalTypeId !== undefined) {
      data.animalType = { connect: { id: Number(animalTypeId) } };
    }
    if (breedId !== undefined) {
      const bid = toNullableInt(breedId);
      data.breed = bid ? { connect: { id: Number(bid) } } : { disconnect: true };
    }
    if (subBreedId !== undefined) {
      const sid = toNullableInt(subBreedId);
      data.subBreed = sid ? { connect: { id: Number(sid) } } : { disconnect: true };
    }
    if (colorId !== undefined) {
      const cid = toNullableInt(colorId);
      data.color = cid ? { connect: { id: Number(cid) } } : { disconnect: true };
    }
    if (coatPatternId !== undefined) {
      const cpid = toNullableInt(coatPatternId);
      data.coatPattern = cpid ? { connect: { id: Number(cpid) } } : { disconnect: true };
    }
    if (sizeId !== undefined) {
      const szid = toNullableInt(sizeId);
      data.size = szid ? { connect: { id: Number(szid) } } : { disconnect: true };
    }
    if (customBreedText !== undefined) data.customBreedText = toNullableString(customBreedText);
    if (customColorText !== undefined) data.customColorText = toNullableString(customColorText);
    if (profilePicId !== undefined) {
      const pid = toNullableInt(profilePicId);
      data.profilePic = pid ? { connect: { id: Number(pid) } } : { disconnect: true };
    }

    // ✅ weight update -> create new PetWeight row (kept separate; updateMany cannot do nested creates)
    const w = toNullableFloat(weightKg);

    // ✅ Ownership check + update in a transaction
    const existing = await prisma.pet.findFirst({
      where: { id: petId, userId: Number(userId), deleted: false },
      select: { id: true, animalTypeId: true, breedId: true, subBreedId: true, colorId: true, coatPatternId: true, sizeId: true, customBreedText: true, customColorText: true },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Pet not found" });
    }

    const taxonomyKeys = ["subBreedId", "colorId", "coatPatternId", "sizeId", "customBreedText", "customColorText", "breedId", "animalTypeId"];
    const taxonomyChanged = taxonomyKeys.some((k) => req.body[k] !== undefined);
    if (taxonomyChanged) {
      const snapshots = await resolveTaxonomySnapshots({
        animalTypeId: animalTypeId !== undefined ? Number(animalTypeId) : existing.animalTypeId,
        breedId: breedId !== undefined ? toNullableInt(breedId) : existing.breedId,
        subBreedId: subBreedId !== undefined ? toNullableInt(subBreedId) : existing.subBreedId,
        colorId: colorId !== undefined ? toNullableInt(colorId) : existing.colorId,
        coatPatternId: coatPatternId !== undefined ? toNullableInt(coatPatternId) : existing.coatPatternId,
        sizeId: sizeId !== undefined ? toNullableInt(sizeId) : existing.sizeId,
        customBreedText: customBreedText !== undefined ? toNullableString(customBreedText) : existing.customBreedText,
        customColorText: customColorText !== undefined ? toNullableString(customColorText) : existing.customColorText,
      });
      data.animalTypeNameSnapshot = snapshots.animalTypeNameSnapshot;
      data.breedNameSnapshot = snapshots.breedNameSnapshot;
      data.subBreedNameSnapshot = snapshots.subBreedNameSnapshot;
      data.colorNameSnapshot = snapshots.colorNameSnapshot;
      data.coatPatternNameSnapshot = snapshots.coatPatternNameSnapshot;
      data.sizeNameSnapshot = snapshots.sizeNameSnapshot;
    }

    await prisma.$transaction(async (tx) => {
      await tx.pet.update({ where: { id: petId }, data });
      if (weightKg !== undefined && w !== null) {
        await tx.petWeight.create({
          data: { petId: petId, weightKg: w, notes: "Updated weight" },
        });
      }
    });

    // return updated pet with relations
    const pet = await prisma.pet.findFirst({
      where: { id: petId, userId: Number(userId) },
      include: {
        animalType: true,
        breed: true,
        subBreed: true,
        color: true,
        coatPattern: true,
        size: true,
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

// --------------------------------------------------
// GET /api/v1/user/pets/:id  (raw pet record)
// --------------------------------------------------
exports.getPetById = async (req, res) => {
  try {
    const userId = req.user?.id;
    const petId = Number(req.params.id);

    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!petId) return res.status(400).json({ success: false, message: "Invalid pet id" });

    const pet = await prisma.pet.findFirst({
      where: { id: petId, userId: Number(userId), deleted: false },
      include: {
        animalType: true,
        breed: true,
        subBreed: true,
        color: true,
        coatPattern: true,
        size: true,
        profilePic: true,
        weights: { orderBy: { recordedAt: "desc" }, take: 1 },
      },
    });

    if (!pet) return res.status(404).json({ success: false, message: "Pet not found" });
    return res.status(200).json({
      success: true,
      data: { ...pet, id: Number(pet.id), userId: Number(pet.userId) },
    });
  } catch (e) {
    console.error("getPetById error:", e);
    return res.status(500).json({ success: false, message: "Failed to load pet" });
  }
};

// --------------------------------------------------
// DELETE /api/v1/user/pets/:id  (soft delete)
// --------------------------------------------------
exports.deletePet = async (req, res) => {
  try {
    const userId = req.user?.id;
    const petId = Number(req.params.id);

    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!petId) return res.status(400).json({ success: false, message: "Invalid pet id" });

    const upd = await prisma.pet.updateMany({
      where: { id: petId, userId: Number(userId), deleted: false },
      data: { deleted: true },
    });

    if (upd.count === 0) {
      return res.status(404).json({ success: false, message: "Pet not found" });
    }

    return res.status(200).json({ success: true, message: "Pet deleted" });
  } catch (e) {
    console.error("deletePet error:", e);
    return res.status(500).json({ success: false, message: e.message || "Server error" });
  }
};

// --------------------------------------------------
// GET /api/v1/user/pets/:id/profile (aggregated for Pet Profile UI)
// Shape matches Flutter PetProfileModel
// --------------------------------------------------
exports.getPetProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    const petId = Number(req.params.id);

    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!petId) return res.status(400).json({ success: false, message: "Invalid pet id" });

    const pet = await prisma.pet.findFirst({
      where: { id: petId, userId: Number(userId), deleted: false },
      include: {
        breed: true,
        profilePic: true,
        weights: { orderBy: { recordedAt: "desc" }, take: 1 },
      },
    });

    if (!pet) return res.status(404).json({ success: false, message: "Pet not found" });

    // Age in years (rough)
    let ageYears = null;
    if (pet.dateOfBirth) {
      const dob = new Date(pet.dateOfBirth);
      const now = new Date();
      const years = now.getFullYear() - dob.getFullYear();
      ageYears = years >= 0 ? years : null;
    }

    const latestWeight = Array.isArray(pet.weights) && pet.weights.length ? pet.weights[0] : null;

    const data = {
      id: Number(pet.id),
      name: pet.name,
      photoUrl: pet.profilePic?.url || null,
      ageYears,
      gender: pet.sex || null,
      breed: pet.breed?.name || null,
      weightKg: latestWeight?.weightKg ?? null,
      healthStatus: {
        vaccinated: false,
        nextDueDate: null,
      },
      pawPoints: 0,
      tier: null,
      familyMembers: [],
    };

    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("getPetProfile error:", e);
    return res.status(500).json({ success: false, message: "Failed to load pet profile" });
  }
};

export {};
