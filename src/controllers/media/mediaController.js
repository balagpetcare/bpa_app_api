const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const sharp = require("sharp");
const { PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");

// const s3Client = require("../../services/s3Client.js"); 
const s3Client = require("../../services/s3Client");
const appConfig = require("../../config/appConfig");


const uploadPetProfileImage = async (req, res) => {
  try {
    const userId = req.user?.id;
    const petId = Number(req.params.petId);

    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!petId || Number.isNaN(petId)) {
      return res.status(400).json({ success: false, message: "Invalid petId" });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, message: "No image uploaded" });
    }

    // ✅ find pet + current media
    const pet = await prisma.pet.findFirst({
      where: { id: petId, userId },
      select: {
        id: true,
        profilePicId: true,
        profilePic: {
          select: {
            id: true,
            key: true,
          },
        },
      },
    });

    if (!pet) {
      return res.status(404).json({ success: false, message: "Pet not found" });
    }

    // ✅ resize & convert
    const processed = await sharp(req.file.buffer)
      .resize(512, 512, { fit: "cover" })
      .jpeg({ quality: 80 })
      .toBuffer();

    // ✅ generate S3 key
    const fileKey = `pets/${userId}/${petId}_${Date.now()}.jpg`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: appConfig.storage.bucketName,
        Key: fileKey,
        Body: processed,
        ContentType: "image/jpeg",
        ACL: "public-read",
      })
    );

    const imageUrl = `${appConfig.storage.publicUrl}/${appConfig.storage.bucketName}/${fileKey}`;

    // ✅ delete old image from S3 if exists
    if (pet.profilePic?.key) {
      try {
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: appConfig.storage.bucketName,
            Key: pet.profilePic.key,
          })
        );
      } catch (e) {
        console.warn("Old image delete failed:", e.message);
      }
    }

    // ✅ upsert media
    let media;
    if (pet.profilePicId) {
      media = await prisma.media.update({
        where: { id: pet.profilePicId },
        data: {
          url: imageUrl,
          key: fileKey,
          type: "image/jpeg",
        },
        select: { id: true, url: true },
      });
    } else {
      media = await prisma.media.create({
        data: {
          url: imageUrl,
          key: fileKey,
          type: "image/jpeg",
        },
        select: { id: true, url: true },
      });

      await prisma.pet.update({
        where: { id: petId },
        data: { profilePicId: media.id },
      });
    }

    return res.status(200).json({
      success: true,
      message: "Pet profile image uploaded successfully",
      data: {
        petId,
        mediaId: media.id,
        imageUrl: media.url,
      },
    });
  } catch (error) {
    console.error("uploadPetProfileImage error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

module.exports = { uploadPetProfileImage };
