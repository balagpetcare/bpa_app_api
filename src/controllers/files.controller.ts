const prisma = require("../infrastructure/db/prismaClient");

const s3Client = require("../infrastructure/storage/s3Client");
const { GetObjectCommand } = require("@aws-sdk/client-s3");

// Allowed origins for CORS on file responses (Next.js panels on different ports).
// CORP cross-origin is required so <img src="http://localhost:3000/api/v1/files/..."> from
// http://localhost:3104 (owner app) is not blocked by ERR_BLOCKED_BY_RESPONSE.NotSameOrigin.
const FILE_ALLOWED_ORIGINS = [
  "http://localhost:3100",
  "http://localhost:3101",
  "http://localhost:3102",
  "http://localhost:3103",
  "http://localhost:3104",
  "http://localhost:3105",
  ...String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
];

function setFileResponseCorsHeaders(req, res, origin) {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  const allowed = FILE_ALLOWED_ORIGINS.length ? FILE_ALLOWED_ORIGINS : [origin].filter(Boolean);
  const echo = origin && allowed.includes(origin) ? origin : allowed[0] || "*";
  res.setHeader("Access-Control-Allow-Origin", echo);
}

async function streamFileByKey(req, res, next) {
  try {
    // IMPORTANT: wildcard key (supports slashes)
    const rawKey = req.params[0];
    const key = decodeURIComponent(rawKey);

    const user = req.user;
    if (!user?.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const doc = await prisma.ownerKycDocument.findFirst({
      where: {
        media: { key },
      },
      select: {
        id: true,
        ownerKyc: { select: { userId: true } },
        media: { select: { key: true, type: true } },
      },
    });

    if (!doc) {
      return res.status(404).json({ message: "File not found" });
    }

    const role = String(user.role || "").toUpperCase();
    const isAdmin = role.includes("ADMIN");

    if (!isAdmin && String(doc.ownerKyc.userId) !== String(user.id)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const bucket = process.env.AWS_BUCKET_NAME || process.env.S3_BUCKET_PRIVATE || process.env.S3_BUCKET || process.env.MINIO_BUCKET;

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const s3Response = await s3Client.send(command);

    const contentType = doc.media.type || "application/octet-stream";
    res.setHeader("Content-Type", contentType);

    const download = String(req.query.download || "") === "1";
    const filename = key.split("/").pop() || "file";
    res.setHeader(
      "Content-Disposition",
      `${download ? "attachment" : "inline"}; filename="${filename}"`
    );

    setFileResponseCorsHeaders(req, res, req.headers.origin);

    s3Response.Body.pipe(res);
  } catch (err) {
    next(err);
  }
}

function optionsFileCors(req, res) {
  setFileResponseCorsHeaders(req, res, req.headers.origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.status(204).end();
}

module.exports = { streamFileByKey, optionsFileCors };

export {};
