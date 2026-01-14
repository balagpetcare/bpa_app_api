const prisma = require("../../../../infrastructure/db/prismaClient");
const { env } = require("../../../../config/env");

// GET /api/v1/common/animal-types
exports.getAnimalTypes = async (req, res) => {
  try {
    const types = await prisma.animalType.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    return res.status(200).json({
      success: true,
      types,
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch animal types",
    });
  }
};

// GET /api/v1/common/breeds/:typeId
exports.getBreedsByType = async (req, res) => {
  try {
    const typeId = Number(req.params.typeId);

    const type = await prisma.animalType.findUnique({
      where: { id: typeId },
      select: { id: true, name: true },
    });

    if (!type) {
      return res.status(404).json({
        success: false,
        message: "Animal type not found",
      });
    }

    const breeds = await prisma.breed.findMany({
      where: { animalTypeId: typeId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    return res.status(200).json({
      success: true,
      type,
      breeds,
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch breeds",
    });
  }
};

// GET /api/v1/common/share-link?type=post|fundraising|user|pet&id=123
// Returns a backend-generated share message + web url + deep link.
exports.getShareLink = async (req, res) => {
  try {
    const typeRaw = String(req.query.type || "").trim().toLowerCase();
    const id = Number(req.query.id);

    const typeMap = {
      post: "post",
      fundraising: "fundraising",
      user: "user",
      pet: "pet",
    };

    const type = typeMap[typeRaw];
    if (!type || !Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid type or id",
      });
    }

    // Optional title/name fetched from DB for nicer share text.
    let label = null;
    if (type === "post") {
      const p = await prisma.post.findUnique({
        where: { id },
        select: { id: true, caption: true },
      });
      label = p?.caption?.trim() ? p.caption.trim().slice(0, 60) : null;
    } else if (type === "fundraising") {
      const c = await prisma.fundraisingCampaign.findUnique({
        where: { id },
        select: { id: true, title: true },
      });
      label = c?.title?.trim() ? c.title.trim() : null;
    } else if (type === "pet") {
      const pet = await prisma.pet.findUnique({
        where: { id },
        select: { id: true, name: true },
      });
      label = pet?.name?.trim() ? pet.name.trim() : null;
    } else if (type === "user") {
      const u = await prisma.user.findUnique({
        where: { id },
        select: { id: true, name: true },
      });
      label = u?.name?.trim() ? u.name.trim() : null;
    }

    const deepLink = `${env.publicDeepLinkScheme}://${type}/${id}`;
    const url = `${env.publicWebUrl}/${type}/${id}`;
    const titlePrefix =
      type === "fundraising"
        ? "Fundraising"
        : type === "post"
          ? "Post"
          : type === "pet"
            ? "Pet Profile"
            : "User Profile";

    const message =
      `${titlePrefix}${label ? `: ${label}` : ""}\n` +
      `${url}\n` +
      `${deepLink}`;

    return res.status(200).json({
      success: true,
      data: { type, id, url, deepLink, message, label },
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: "Failed to generate share link",
    });
  }
};

// ==========================
// Bangladesh Locations
// ==========================
// GET /api/v1/common/bd/divisions
exports.getBdDivisions = async (req, res) => {
  try {
    const items = await prisma.bdDivision.findMany({
      select: { id: true, code: true, nameEn: true, nameBn: true },
      orderBy: { nameEn: "asc" },
    });
    return res.status(200).json({ success: true, items });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Failed to fetch divisions" });
  }
};

// GET /api/v1/common/bd/districts?divisionId=1
exports.getBdDistricts = async (req, res) => {
  try {
    const divisionId = Number(req.query.divisionId);
    if (!Number.isFinite(divisionId) || divisionId <= 0) {
      return res.status(400).json({ success: false, message: "divisionId is required" });
    }

    const items = await prisma.bdDistrict.findMany({
      where: { divisionId },
      select: { id: true, code: true, nameEn: true, nameBn: true, divisionId: true },
      orderBy: { nameEn: "asc" },
    });
    return res.status(200).json({ success: true, items });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Failed to fetch districts" });
  }
};

// GET /api/v1/common/bd/upazilas?districtId=1
exports.getBdUpazilas = async (req, res) => {
  try {
    const districtId = Number(req.query.districtId);
    if (!Number.isFinite(districtId) || districtId <= 0) {
      return res.status(400).json({ success: false, message: "districtId is required" });
    }

    const items = await prisma.bdUpazila.findMany({
      where: { districtId },
      select: { id: true, code: true, nameEn: true, nameBn: true, districtId: true },
      orderBy: { nameEn: "asc" },
    });
    return res.status(200).json({ success: true, items });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Failed to fetch upazilas" });
  }
};

// GET /api/v1/common/bd/areas?upazilaId=1
exports.getBdAreas = async (req, res) => {
  try {
    const upazilaId = Number(req.query.upazilaId);
    if (!Number.isFinite(upazilaId) || upazilaId <= 0) {
      return res.status(400).json({ success: false, message: "upazilaId is required" });
    }

    const items = await prisma.bdArea.findMany({
      where: { upazilaId },
      select: { id: true, code: true, nameEn: true, nameBn: true, type: true, upazilaId: true },
      orderBy: { nameEn: "asc" },
    });
    return res.status(200).json({ success: true, items });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Failed to fetch areas" });
  }
};


// GET /api/v1/common/bd/city-corporations?districtId=47
exports.getBdCityCorporations = async (req, res) => {
  try {
    const districtId = Number(req.query.districtId);
    if (!Number.isFinite(districtId) || districtId <= 0) {
      return res.status(400).json({ success: false, message: "districtId is required" });
    }

    const items = await prisma.bdArea.findMany({
      where: { districtId, type: "CITY_CORPORATION" },
      select: { id: true, code: true, nameEn: true, nameBn: true, type: true, districtId: true, parentId: true },
      orderBy: { nameEn: "asc" },
    });

    return res.status(200).json({ success: true, items });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Failed to fetch city corporations" });
  }
};

// GET /api/v1/common/bd/zones?cityCorporationId=123
exports.getBdZones = async (req, res) => {
  try {
    const cityCorporationId = Number(req.query.cityCorporationId);
    if (!Number.isFinite(cityCorporationId) || cityCorporationId <= 0) {
      return res.status(400).json({ success: false, message: "cityCorporationId is required" });
    }

    const items = await prisma.bdArea.findMany({
      where: { parentId: cityCorporationId, type: "ZONE" },
      select: { id: true, code: true, nameEn: true, nameBn: true, type: true, districtId: true, parentId: true },
      orderBy: { nameEn: "asc" },
    });

    return res.status(200).json({ success: true, items });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Failed to fetch zones" });
  }
};

// GET /api/v1/common/bd/cc-areas?zoneId=456
exports.getBdCcAreas = async (req, res) => {
  try {
    const zoneId = Number(req.query.zoneId);
    if (!Number.isFinite(zoneId) || zoneId <= 0) {
      return res.status(400).json({ success: false, message: "zoneId is required" });
    }

    const items = await prisma.bdArea.findMany({
      where: { parentId: zoneId, type: "AREA" },
      select: { id: true, code: true, nameEn: true, nameBn: true, type: true, districtId: true, parentId: true },
      orderBy: { nameEn: "asc" },
    });

    return res.status(200).json({ success: true, items });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Failed to fetch city areas" });
  }
};
