const router = require("express").Router();
const multer = require("multer");

const auth = require("../../../../middleware/auth.middleware");
const media = require("./media.controller");
const appConfig = require("../../../../config/appConfig");

// ✅ Standard: memory storage so buffers are available (sharp / optional ffmpeg)
// Accept ANY field names to avoid silent client-side breakage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(appConfig.mediaPolicy?.maxUploadBytes || process.env.MAX_UPLOAD_BYTES || 100 * 1024 * 1024), // default 100MB
  },
});

// POST /api/v1/media/upload
// Compatible field names:
// - file (recommended)
// - media (legacy)
// - files / files[] (multiple)
router.post("/upload", auth, upload.any(), media.uploadMedia);

// GET /api/v1/media/my
router.get("/my", auth, media.myMedia);

// DELETE /api/v1/media/:id
router.delete("/:id", auth, media.delete);

module.exports = router;

export {};
