const { PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");

const prisma = require("../../../../infrastructure/db/prismaClient");
const s3Client = require("../../../../infrastructure/storage/s3Client");
const appConfig = require("../../../../config/appConfig");

function extFromMime(mime) {
  if (!mime) return "";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  if (mime === "application/pdf") return ".pdf";
  return "";
}

function buildKey({ ownerId, folder, mimeType }) {
  const rand = crypto.randomBytes(10).toString("hex");
  const ext = extFromMime(mimeType);
  return `${folder}/${ownerId}/${Date.now()}_${rand}${ext}`;
}

function buildPublicUrl(key) {
  // MINIO_PUBLIC_URL (default http://localhost:9000) + /bucket/key
  const base = appConfig.storage.publicUrl.replace(/\/$/, "");
  return `${base}/${appConfig.storage.bucketName}/${key}`;
}

async function uploadToStorage({ buffer, mimeType, key }) {
  const cmd = new PutObjectCommand({
    Bucket: appConfig.storage.bucketName,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  });

  await s3Client.send(cmd);
  return buildPublicUrl(key);
}

async function deleteFromStorage(key) {
  const cmd = new DeleteObjectCommand({
    Bucket: appConfig.storage.bucketName,
    Key: key,
  });
  await s3Client.send(cmd);
}

exports.uploadAndCreateMedia = async ({ ownerId, file, folder = "media", meta }) => {
  if (!file?.buffer) throw new Error("File buffer missing");

  const key = buildKey({ ownerId, folder, mimeType: file.mimetype });
  const url = await uploadToStorage({
    buffer: file.buffer,
    mimeType: file.mimetype,
    key,
  });

  // ✅ NOTE:
  // আপনার Prisma schema অনুযায়ী field name adjust লাগতে পারে:
  // - ownerId / userId
  // - key / objectKey
  // - url / fileUrl
  const media = await prisma.media.create({
    data: {
      ownerId, // <-- যদি আপনার schema এ ownerUserId হয় তাহলে ownerUserId দিন
      key,
      url,
      mimeType: file.mimetype,
      size: file.size,
      originalName: file.originalname,
      folder,
      // meta JSON field থাকলে রেখে দিন (optional)
      ...(meta ? { meta } : {}),
    },
  });

  return media;
};

exports.listMyMedia = async (ownerId) => {
  return prisma.media.findMany({
    where: { ownerId },
    orderBy: { id: "desc" },
  });
};

exports.deleteMyMedia = async ({ ownerId, mediaId }) => {
  const id = Number(mediaId);

  const media = await prisma.media.findFirst({
    where: { id, ownerId },
  });

  if (!media) {
    const err = new Error("Media not found");
    err.statusCode = 404;
    throw err;
  }

  // storage delete first (or after db delete—either ok)
  await deleteFromStorage(media.key);

  await prisma.media.delete({ where: { id } });

  return { deleted: true };
};
