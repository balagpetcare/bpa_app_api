const mediaService = require("./media.service");
const { processUploadFile } = require("./media.processor");

function pickFiles(req) {
  // multer.any() puts files in req.files (array)
  if (Array.isArray(req.files) && req.files.length) return req.files;

  // multer.fields() puts files in req.files.<name>
  if (req.files && typeof req.files === "object") {
    const a = [];
    for (const k of Object.keys(req.files)) {
      const v = req.files[k];
      if (Array.isArray(v)) a.push(...v);
    }
    if (a.length) return a;
  }

  // multer.single()
  if (req.file) return [req.file];
  return [];
}

exports.uploadMedia = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const files = pickFiles(req);
    if (!files.length) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded. Use multipart/form-data with field name 'file' (or legacy 'media', or 'files[]').",
      });
    }

    // Allow both single and multiple uploads.
    // - single: return {data: media}
    // - multiple: return {data: [media,...]}
    const wantMultiple =
      files.length > 1 ||
      String(req.query.multiple || req.body?.multiple || "").toLowerCase() === "1" ||
      String(req.query.multiple || req.body?.multiple || "").toLowerCase() === "true";

    const folder = String(req.body?.folder || req.query.folder || "media");

    const created = [];
    for (const f of files) {
      // Standard processing:
      // - image: resize + jpeg compress
      // - video: optional transcode if VIDEO_TRANSCODE=true and ffmpeg present
      const processed = await processUploadFile(f);

      const media = await mediaService.uploadAndCreateMedia({
        ownerUserId: Number(userId),
        file: processed,
        folder,
      });
      created.push(media);
    }

    return res.status(201).json({ success: true, data: wantMultiple ? created : created[0] });
  } catch (e) {
    console.error("mediaUpload error:", e);
    return res.status(500).json({ success: false, message: e.message || "Upload failed" });
  }
};

exports.myMedia = async (req, res) => {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const list = await mediaService.listMyMedia(Number(ownerUserId));

    return res.status(200).json({ success: true, data: list });
  } catch (e) {
    console.error("myMedia error:", e);
    return res.status(500).json({ success: false, message: e.message || "Failed" });
  }
};

exports.delete = async (req, res) => {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    await mediaService.deleteMyMedia({
      ownerUserId: Number(ownerUserId),
      mediaId: Number(req.params.id),
    });
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("deleteMedia error:", e);
    return res.status(500).json({ success: false, message: e.message || "Failed to delete" });
  }
};
