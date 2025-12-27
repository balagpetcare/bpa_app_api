const multer = require("multer");

// memory storage (buffer দিয়ে S3/MinIO তে পাঠাবো)
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  // basic image allow-list (আপনি চাইলে pdf/video allow করতে পারেন)
  const ok =
    file.mimetype.startsWith("image/") ||
    file.mimetype === "application/pdf";

  if (!ok) return cb(new Error("Only image/pdf files are allowed"), false);
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

module.exports = upload;
