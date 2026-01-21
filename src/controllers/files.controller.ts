const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const s3Client = require("../infrastructure/storage/s3Client");
const { GetObjectCommand } = require("@aws-sdk/client-s3");

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

    res.setHeader("Content-Type", doc.media.type || "application/octet-stream");

    const download = String(req.query.download || "") === "1";
    res.setHeader(
      "Content-Disposition",
      `${download ? "attachment" : "inline"}; filename="${key.split("/").pop()}"`
    );

    s3Response.Body.pipe(res);
  } catch (err) {
    next(err);
  }
}

module.exports = { streamFileByKey };

export {};
