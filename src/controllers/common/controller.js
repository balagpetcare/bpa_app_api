const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

exports.getAnimalTypes = async (req, res) => {
  try {
    const types = await prisma.animalType.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return res.status(200).json({ success: true, types });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Failed to fetch animal types" });
  }
};

exports.getBreedsByType = async (req, res) => {
  try {
    const typeId = Number(req.params.typeId);
    if (!typeId || Number.isNaN(typeId)) {
      return res.status(400).json({ success: false, message: "Invalid typeId" });
    }

    const type = await prisma.animalType.findUnique({
      where: { id: typeId },
      select: { id: true, name: true },
    });

    if (!type) {
      return res.status(404).json({ success: false, message: "Animal type not found" });
    }

    const breeds = await prisma.breed.findMany({
      where: { animalTypeId: typeId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    return res.status(200).json({ success: true, type, breeds });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Failed to fetch breeds" });
  }
};
