// src/middlewares/upload.memory.js
const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024), // default 10MB
  },
});

// single file: upload.single("media")
// multiple: upload.array("media", 10)

module.exports = upload;
