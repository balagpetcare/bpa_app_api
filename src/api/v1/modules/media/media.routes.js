const router = require("express").Router();
const multer = require("multer");

const auth = require("../../../../middleware/auth.middleware");
const media = require("./media.controller");

// ✅ memory storage so req.file.buffer is available for sharp
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/v1/media/upload (form-data: file)
router.post("/upload", auth, upload.single("file"), media.uploadMedia);

// GET /api/v1/media/my
router.get("/my", auth, media.myMedia);

// DELETE /api/v1/media/:id
router.delete("/:id", auth, media.delete);

module.exports = router;
