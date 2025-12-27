const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const prisma = require("../../../../infrastructure/db/prismaClient");

exports.uploadMedia = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    // Debug (keep for now)
    // console.log("uploadMedia hit", { hasUser: !!req.user, hasFile: !!req.file, bodyKeys: Object.keys(req.body || {}) });

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded. Use multipart/form-data with field name 'file'.",
      });
    }

    // ensure upload dir
    const uploadDir = path.join(process.cwd(), "uploads");
    fs.mkdirSync(uploadDir, { recursive: true });

    const filename = `media_${Date.now()}.jpg`;
    const filepath = path.join(uploadDir, filename);

    // compress
    await sharp(req.file.buffer)
      .rotate()
      .resize(1024, 1024, { fit: "inside" })
      .jpeg({ quality: 75 })
      .toFile(filepath);

    const url = `${req.protocol}://${req.get("host")}/uploads/${filename}`;

    const media = await prisma.media.create({
      data: {
        url,
        ownerUserId: Number(userId),
        type: "IMAGE",
      },
    });

    return res.status(201).json({ success: true, data: media });
  } catch (e) {
    console.error("mediaUpload error:", e);
    return res.status(500).json({ success: false, message: e.message || "Upload failed" });
  }
};

exports.myMedia = async (req, res) => {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const list = await prisma.media.findMany({
      where: { ownerUserId: Number(ownerUserId), deletedAt: null },
      orderBy: { id: "desc" },
    });

    return res.status(200).json({ success: true, data: list });
  } catch (e) {
    console.error("myMedia error:", e);
    return res.status(500).json({ success: false, message: e.message || "Failed" });
  }
};

exports.delete = async (req, res) => {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const mediaId = Number(req.params.id);

    const updated = await prisma.media.updateMany({
      where: { id: mediaId, ownerUserId: Number(ownerUserId), deletedAt: null },
      data: { deletedAt: new Date() },
    });

    if (updated.count === 0) {
      return res.status(404).json({ success: false, message: "Media not found" });
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("deleteMedia error:", e);
    return res.status(500).json({ success: false, message: e.message || "Failed to delete" });
  }
};
