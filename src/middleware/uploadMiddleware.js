const multer = require("multer");

const storage = multer.memoryStorage();

// allow common image mime + octet-stream (some clients send this)
const allowedMime = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/octet-stream",
]);

// simple magic-number check (security)
function looksLikeImage(buffer) {
  if (!buffer || buffer.length < 12) return false;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) return true;

  // WEBP: "RIFF"...."WEBP"
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) return true;

  return false;
}

const fileFilter = (req, file, cb) => {
  console.log("UPLOAD FILE:", file.originalname, file.mimetype);

  const mime = (file.mimetype || "").toLowerCase();

  if (!allowedMime.has(mime)) {
    return cb(
      new Error(
        `Invalid file type: ${mime}. Allowed: jpg/jpeg/png/webp.`
      ),
      false
    );
  }

  // ✅ allow now; we will validate buffer in controller (after multer reads it)
  return cb(null, true);
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter,
});

module.exports = upload;

// export helper (optional)
module.exports.looksLikeImage = looksLikeImage;
