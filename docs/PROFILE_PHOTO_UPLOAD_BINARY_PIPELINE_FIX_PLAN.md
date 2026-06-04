# Profile photo upload — binary pipeline fix

## Root cause

1. **`react-easy-crop` coordinate contract**
   `onCropComplete`’s **`croppedAreaPixels`** are **not** “display × scale to natural” in a way that matched the old helper. They are computed in **`rotateSize(naturalWidth, naturalHeight, rotation)`** space (see `node_modules/react-easy-crop` `computeCroppedArea`).

2. **Custom `cropToBlob` in `ImageCropperModal` (removed)**
   The previous implementation mixed **`img.width` / `img.naturalWidth` scaling** with **`drawImage`** extraction from an intermediate rotated canvas. That path could **misalign** crop rectangles with what the library reports, yielding **empty, clipped, or invalid** canvas output. **`canvas.toBlob("image/jpeg")`** could then produce buffers **Sharp rejects** as *“Input buffer contains unsupported image format”* (not a valid JPEG bitstream), even when the client labeled the part as `image/jpeg`.

3. **Authoritative fix in-repo**
   The shared module already had **`cropImageToBlob`** in `src/media/cropper/cropUtils.ts`, which:
   - Uses **`naturalWidth` / `naturalHeight`** consistently with **`rotateSize(..., rotation)`**
   - Extracts the crop with **`getImageData`** in the same coordinate model **`react-easy-crop`** uses
   **`ImageCropperModal` now delegates to `cropImageToBlob`** instead of duplicating logic.

## Was client-side encoding the issue?

**Partially.** JPEG encoding via canvas is generally fine; the **bad binary** was a consequence of **wrong crop math / extraction**, not MIME type alone.

## Final client upload format

- **Avatar preset** remains **`jpg`** (`config-presets` AVATAR) → **`image/jpeg`** upload with correct **`.jpg`** filename and `File.type`.
- **FormData**: still **`file`** field with a real **`File`** built from the **`Blob`**.

## Final backend storage format

- Unchanged: **`optimizeProfilePhotoFile`** → **WebP** **512×512** (cover) after a successful **Sharp metadata** probe.

## Error contract

- **400** + `code: "INVALID_IMAGE_PAYLOAD"` when Sharp cannot decode the uploaded buffer (unchanged intent).
- Crop modal: inline **`cropError`** if the crop pipeline throws or produces a blob **&lt; 64 bytes**.

## Test cases to verify

1. Crop + upload typical JPG / PNG / WebP sources → success.
2. Retry after failure → no stuck loading; user can pick again.
3. Remove photo → unchanged.
4. Account hub + header refresh after success → `bpa:me-refresh` / `useMe` unchanged.

## Files changed

| File | Change |
|------|--------|
| `bpa_web/src/media/cropper/ImageCropperModal.tsx` | Use **`cropImageToBlob`**; remove custom **`cropToBlob`**; **`cropError` UI**; minimum output size guard |
