/**
 * Legacy compatibility controller.
 *
 * Some older parts of the codebase referenced:
 *   src/controllers/mediaUploaderController/mediaUploaderController.js
 *
 * We keep this file as an adapter so existing imports keep working,
 * while the actual implementation lives in the Media module.
 */
const mediaController = require("../../api/v1/modules/media/media.controller");

module.exports = {
  uploadMedia: mediaController.uploadMedia,
  myMedia: mediaController.myMedia,
};
