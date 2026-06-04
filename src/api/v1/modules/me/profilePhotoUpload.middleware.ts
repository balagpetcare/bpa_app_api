/**
 * Multer setup + error normalization for profile photo uploads.
 * CJS-compatible exports for me.routes.ts (require).
 */

import type { NextFunction, Request, Response } from "express";
import {
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_MAX_MB,
  isAllowedProfilePhotoMime,
} from "./profilePhotoUpload.config";

const multer = require("multer");

const profilePhotoUploader = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: PROFILE_PHOTO_MAX_BYTES,
    files: 1,
    fields: 20,
    parts: 25,
  },
  fileFilter: (_req: Request, file: { mimetype?: string }, cb: (e: Error | null, acceptFile?: boolean) => void) => {
    if (isAllowedProfilePhotoMime(file.mimetype)) {
      return cb(null, true);
    }
    const err: Error & { code?: string; statusCode?: number } = new Error(
      "Profile image must be JPG, PNG, or WEBP."
    );
    err.code = "INVALID_FILE_TYPE";
    err.statusCode = 400;
    return cb(err);
  },
});

export function normalizeProfilePhotoUploadError(err: unknown): Error {
  const e = err as {
    code?: string;
    name?: string;
    message?: string;
    statusCode?: number;
  };

  if (e?.code === "INVALID_FILE_TYPE" && e?.statusCode === 400) {
    return err as Error;
  }

  if (e?.name === "MulterError" || e?.code === "LIMIT_FILE_SIZE") {
    if (e.code === "LIMIT_FILE_SIZE") {
      const out: Error & { code?: string; statusCode?: number; meta?: { maxSizeMb: number } } =
        new Error("Profile image is too large. Please upload a smaller image.");
      out.code = "FILE_TOO_LARGE";
      out.statusCode = 400;
      out.meta = { maxSizeMb: PROFILE_PHOTO_MAX_MB };
      return out;
    }
    if (
      e.code === "LIMIT_UNEXPECTED_FILE" ||
      e.code === "LIMIT_FILE_COUNT" ||
      e.code === "LIMIT_PART_COUNT" ||
      e.code === "LIMIT_FIELD_KEY"
    ) {
      const out: Error & { code?: string; statusCode?: number } = new Error(
        "Invalid upload request. Send a single image in the \"file\" field."
      );
      out.code = "INVALID_MULTIPART_PAYLOAD";
      out.statusCode = 400;
      return out;
    }
    const out: Error & { code?: string; statusCode?: number } = new Error(
      "Could not read the uploaded file. Please try again."
    );
    out.code = "INVALID_MULTIPART_PAYLOAD";
    out.statusCode = 400;
    return out;
  }

  const msg = String(e?.message || "Upload failed.");
  const out: Error & { code?: string; statusCode?: number } = new Error(msg);
  out.code = "FILE_UPLOAD_FAILED";
  out.statusCode = 400;
  return out;
}

/** Use after `auth`: runs multer.single("file") and maps errors for the global handler. */
export function runProfilePhotoUpload(req: Request, res: Response, next: NextFunction): void {
  profilePhotoUploader.single("file")(req, res, (multerErr: unknown) => {
    if (!multerErr) return next();
    return next(normalizeProfilePhotoUploadError(multerErr));
  });
}

module.exports = {
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_MAX_MB,
  runProfilePhotoUpload,
  normalizeProfilePhotoUploadError,
};
