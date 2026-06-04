/**
 * Shared limits for /api/v1/me/profile/photo (multer + service validation).
 */

export const PROFILE_PHOTO_MAX_MB = 8;
export const PROFILE_PHOTO_MAX_BYTES = PROFILE_PHOTO_MAX_MB * 1024 * 1024;

export const PROFILE_PHOTO_ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

export function isAllowedProfilePhotoMime(mime: string | undefined | null): boolean {
  const m = String(mime || "")
    .toLowerCase()
    .trim();
  return (PROFILE_PHOTO_ALLOWED_MIMES as readonly string[]).includes(m);
}
