# Profile photo WebP buffer failure — fix plan

## Root cause

- **Client `canvas.toBlob("image/webp", …)`** is **not reliably interoperable** with **Sharp/libvips** in practice: some browsers produce **invalid or non-standard WebP** bytes that fail with errors such as `Input buffer has corrupt header: webp: unable to parse image`.
- The crop modal built **`File`** names **without a file extension**, so `originalname` did not reflect the real payload (minor; multer still used MIME from the part).
- **Backend** treated Sharp failures as a generic **500** (`FILE_UPLOAD_FAILED`) instead of a **400** with a dedicated code.

## Was client-side WebP the issue?

**Yes.** The **avatar** preset used **`format: "webp"`**, so the upload path depended on browser WebP encoding quality. **JPEG** from `canvas.toBlob("image/jpeg")` is **widely reliable**; the API still stores **WebP** after server-side `optimizeProfilePhotoFile`.

## Final upload format path

| Stage | Format |
|-------|--------|
| Crop output (avatar preset) | **JPEG** (`image/jpeg`), quality **0.88**, max **512×512** in crop |
| Upload multipart | `file` field; MIME **image/jpeg** (or PNG/WEBP from direct picks if ever used) |
| Stored object | **WebP** **512×512** (cover), server-side Sharp (unchanged policy) |

## Optional safety

- **`ImageCropperModal` `cropToBlob`**: if preset asks for **WebP** and the blob is **null or tiny**, **retry once as JPEG** (protects non-avatar presets that still use WebP).

## Backend validation strategy

1. **`optimizeProfilePhotoFile`** calls **`sharp(buffer).metadata()`** first. Failure → throw **`Error` with `code: 'INVALID_IMAGE_PAYLOAD'`**.
2. **Resize/WebP** pipeline failure → same **`INVALID_IMAGE_PAYLOAD`** (no raw Sharp message to clients).
3. **`uploadProfilePhoto`** maps **`INVALID_IMAGE_PAYLOAD`** → **HTTP 400**, **`code: "INVALID_IMAGE_PAYLOAD"`**, user-facing message: *"Selected image could not be processed. Please try another image."*
4. Unexpected errors remain **500** + **`FILE_UPLOAD_FAILED`**.

## Error response contract

```json
{
  "success": false,
  "message": "Selected image could not be processed. Please try another image.",
  "code": "INVALID_IMAGE_PAYLOAD"
}
```

## Frontend UX

- **`messageFromProfilePhotoError`** handles **`INVALID_IMAGE_PAYLOAD`** with the same copy as the API.
- **`File` construction** uses **extension + MIME aligned to actual `blob.type`** (especially if WebP fallback produced JPEG).

## Test cases to verify

1. Crop + upload **JPG** source → success; stored **WebP** avatar.
2. Crop + upload **PNG** source → success.
3. Crop + upload **WEBP** source → success when Sharp decodes input; otherwise **400** + clean message.
4. Retry after failed upload → works; loading state cleared in **`finally`** (existing).
5. Remove photo → unchanged.
6. **`bpa:me-refresh`** after success → header/account hub update (existing).

## Files changed (implementation)

| Area | File |
|------|------|
| Frontend | `src/media/cropper/config-presets.ts` — AVATAR **`jpg`** output |
| Frontend | `src/media/cropper/ImageCropperModal.tsx` — WebP blob safety; **File** name/MIME from **blob** |
| Frontend | `src/components/account/AccountHubPage.tsx` — **`INVALID_IMAGE_PAYLOAD`** message; fallback **`profile-photo.jpg`** |
| Backend | `src/api/v1/modules/media/media.processor.ts` — probe + **`INVALID_IMAGE_PAYLOAD`** |
| Backend | `src/api/v1/modules/me/meProfile.service.ts` — map code; remove redundant post-process metadata block |
