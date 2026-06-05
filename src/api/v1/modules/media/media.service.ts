const crypto = require("crypto");

const prisma = require("../../../../infrastructure/db/prismaClient");
const { getStorageProvider } = require("../../../../infrastructure/storage/storage.factory");
const appConfig = require("../../../../config/appConfig");
const {
  buildPublicMediaUrl,
  resolveClientMediaUrl,
} = require("../../../../shared/storage/publicMediaUrl");

function extFromName(name) {
  const n = String(name || "");
  const m = n.match(/\.([a-zA-Z0-9]+)$/);
  if (!m) return "";
  return "." + m[1].toLowerCase();
}

function guessMimeFromExt(ext) {
  const e = String(ext || "").toLowerCase();
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".png") return "image/png";
  if (e === ".webp") return "image/webp";
  if (e === ".gif") return "image/gif";
  if (e === ".mp4") return "video/mp4";
  if (e === ".mov") return "video/quicktime";
  if (e === ".pdf") return "application/pdf";
  if (e === ".txt") return "text/plain";
  return "application/octet-stream";
}

function extFromMime(mime) {
  if (!mime) return "";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  if (mime === "video/mp4") return ".mp4";
  if (mime === "video/quicktime") return ".mov";
  if (mime === "application/pdf") return ".pdf";
  return "";
}

function mediaTypeFromMime(mime, originalname) {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('video/')) return 'VIDEO';
  if (m.startsWith('image/')) return 'IMAGE';
  // fall back to extension when content-type is generic
  const ext = extFromName(originalname);
  if (['.mp4', '.mov', '.m4v', '.avi', '.mkv'].includes(ext)) return 'VIDEO';
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'].includes(ext)) return 'IMAGE';
  return 'FILE';
}

function buildKey({ ownerUserId, folder, mimeType, originalname, countryCode }) {
  const rand = crypto.randomBytes(10).toString("hex");
  const ext = extFromMime(mimeType) || extFromName(originalname);
  const prefix = appConfig.storage.useCountryPrefix && countryCode
    ? `${String(countryCode).toUpperCase().slice(0, 2)}/`
    : "";
  return `${prefix}${folder}/${ownerUserId}/${Date.now()}_${rand}${ext}`;
}

async function storageObjectExists(key) {
  return getStorageProvider().objectExists(key);
}

function withResolvedUrl(media) {
  if (!media) return media;
  return {
    ...media,
    url: resolveClientMediaUrl({ url: media.url, key: media.key }),
  };
}

async function uploadToStorage({ buffer, mimeType, key, originalname }) {
  // Some clients send application/octet-stream; storage UI preview needs a real content-type.
  let ct = mimeType;
  if (!ct || ct === "application/octet-stream") {
    ct = guessMimeFromExt(extFromName(originalname));
  }
  await getStorageProvider().putObject({
    key,
    body: buffer,
    contentType: ct,
  });
  return buildPublicMediaUrl(key);
}

async function deleteFromStorage(key) {
  await getStorageProvider().deleteObject(key);
}

/**
 * Standard upload helper used across the app.
 * - Stores file in S3/MinIO
 * - Creates Media row
 * - Computes a content hash so we can later reuse/deduplicate files
 */
exports.uploadAndCreateMedia = async ({ ownerUserId, file, folder = "media", type, countryCode }) => {
  if (!file?.buffer) {
    const err = new Error("File buffer missing");
    (err as any).statusCode = 400;
    throw err;
  }

  const buffer = file.buffer;
  const mimeType = file.mimetype;
  const originalname = file.originalname || "upload";

  // Compute hash for possible reuse/deduplication
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");

  const mediaType = type || mediaTypeFromMime(mimeType, originalname);
  const existing = await prisma.media.findFirst({
    where: { hash },
  });

  if (existing) {
    const existsInStorage = existing.key ? await storageObjectExists(existing.key) : false;
    if (existsInStorage) {
      const resolvedUrl = buildPublicMediaUrl(existing.key);
      if (resolvedUrl !== existing.url) {
        const updated = await prisma.media.update({
          where: { id: existing.id },
          data: { url: resolvedUrl },
        });
        return withResolvedUrl(updated);
      }
      return withResolvedUrl(existing);
    }

    const repairKey = buildKey({ ownerUserId, folder, mimeType, originalname, countryCode });
    const repairUrl = await uploadToStorage({
      buffer,
      mimeType,
      key: repairKey,
      originalname,
    });
    const repaired = await prisma.media.update({
      where: { id: existing.id },
      data: {
        url: repairUrl,
        key: repairKey,
        type: mediaType,
        mimeType,
        sizeBytes: buffer.length,
        altText: originalname,
      },
    });
    return withResolvedUrl(repaired);
  }

  const key = buildKey({ ownerUserId, folder, mimeType, originalname, countryCode });
  const url = await uploadToStorage({
    buffer,
    mimeType,
    key,
    originalname,
  });

  const media = await prisma.media.create({
    data: {
      url,
      key,
      type: mediaType,
      ownerUserId: Number(ownerUserId),
      mimeType,
      sizeBytes: buffer.length,
      hash,
      altText: originalname,
    },
  });

  return withResolvedUrl(media);
};

exports.listMyMedia = async (ownerUserId) => {
  const rows = await prisma.media.findMany({
    where: { ownerUserId: Number(ownerUserId), deletedAt: null },
    orderBy: { id: "desc" },
  });
  return rows.map(withResolvedUrl);
};

exports.deleteMyMedia = async ({ ownerUserId, mediaId }) => {
  const id = Number(mediaId);

  const media = await prisma.media.findFirst({
    where: { id, ownerUserId: Number(ownerUserId), deletedAt: null },
  });

  if (!media) {
    const err = new Error("Media not found");
    (err as any).statusCode = 404;
    throw err;
  }

  // Delete from storage if key exists
  await deleteFromStorage(media.key);

  // Soft delete to keep references safe
  await prisma.media.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return { deleted: true };
};

export {};
