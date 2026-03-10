const { PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");

const prisma = require("../../../../infrastructure/db/prismaClient");
const s3Client = require("../../../../infrastructure/storage/s3Client");
const appConfig = require("../../../../config/appConfig");

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

function buildPublicUrl(key) {
  // MINIO_PUBLIC_URL (e.g. http://10.0.2.2:9000) + /bucket/key
  const base = String(appConfig.storage.publicUrl || appConfig.storage.endpoint || "").replace(/\/$/, "");
  return `${base}/${appConfig.storage.bucketName}/${key}`;
}

async function uploadToStorage({ buffer, mimeType, key, originalname }) {
  // Some clients send application/octet-stream; MinIO UI preview needs a real content-type.
  let ct = mimeType;
  if (!ct || ct === "application/octet-stream") {
    ct = guessMimeFromExt(extFromName(originalname));
  }
  const cmd = new PutObjectCommand({
    Bucket: appConfig.storage.bucketName,
    Key: key,
    Body: buffer,
    ContentType: ct,
  });
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/b9a50c8d-67c2-4353-bdac-e3b81804031b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4e348a'},body:JSON.stringify({sessionId:'4e348a',runId:'run1',hypothesisId:'H2',location:'media.service.ts:uploadToStorage:beforeSend',message:'about to send PutObject',data:{endpoint:String(appConfig?.storage?.endpoint||''),bucket:String(appConfig?.storage?.bucketName||''),forcePathStyle:!!appConfig?.storage?.forcePathStyle,keyPrefix:String(key||'').split('/').slice(0,2).join('/')},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  try {
    await s3Client.send(cmd);
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/b9a50c8d-67c2-4353-bdac-e3b81804031b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4e348a'},body:JSON.stringify({sessionId:'4e348a',runId:'run1',hypothesisId:'H1',location:'media.service.ts:uploadToStorage:sendError',message:'PutObject failed',data:{errorName:String((err as any)?.name||''),errorCode:String((err as any)?.code||''),errorMessage:String((err as any)?.message||''),hostname:String((err as any)?.hostname||'')},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    throw err;
  }
  return buildPublicUrl(key);
}

async function deleteFromStorage(key) {
  if (!key) return;
  const cmd = new DeleteObjectCommand({
    Bucket: appConfig.storage.bucketName,
    Key: key,
  });
  await s3Client.send(cmd);
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

  // If a media with the same hash already exists, just reuse it
  const existing = await prisma.media.findFirst({
    where: { hash },
  });
  if (existing) {
    return existing;
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
      type: type || mediaTypeFromMime(mimeType, originalname),
      ownerUserId: Number(ownerUserId),
      mimeType,
      sizeBytes: buffer.length,
      hash,
      altText: originalname,
    },
  });

  return media;
};

exports.listMyMedia = async (ownerUserId) => {
  return prisma.media.findMany({
    where: { ownerUserId: Number(ownerUserId), deletedAt: null },
    orderBy: { id: "desc" },
  });
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
