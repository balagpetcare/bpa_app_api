# Profile photo binary pipeline — final fix

## Exact root cause

**The Next.js API proxy at `bpa_web/app/api/v1/[[...path]]/route.js` called `request.text()` before forwarding to the backend.** `request.text()` decodes the raw binary request body as UTF-8, then that UTF-8 string is forwarded to Express/Multer. Multer on the backend receives a **UTF-8 re-encoded copy** of the original binary image — not the original bytes. When Sharp tries to decode the buffer it gets "Input buffer contains unsupported image format" because JPEG/PNG magic bytes have been corrupted by the encoding round-trip.

### Why `.text()` corrupts binary

JPEG files start with `\xFF\xD8\xFF` and contain many bytes ≥ 0x80. UTF-8 encodes those bytes as multi-byte sequences. When the resulting string is later read as bytes (via the node `fetch` body), the byte count and content differ from the original — producing a buffer that is no longer a valid JPEG/PNG/WebP stream.

## The file/frontend was NOT the problem

All previous fixes to `ImageCropperModal`, `cropImageToBlob`, presets, and `meProfile.service.ts` were reasonable hardening but did not address this root cause. The image bytes produced by the browser were **always correct**; they were corrupted in transit by the proxy layer.

## Fix applied

`app/api/v1/[[...path]]/route.js` — replace:

```js
const body = await request.text();
if (body) opts.body = body;
```

with:

```js
const bodyBuf = await request.arrayBuffer();
if (bodyBuf.byteLength > 0) opts.body = bodyBuf;
```

`request.arrayBuffer()` preserves binary fidelity through the proxy. The `content-type: multipart/form-data; boundary=...` header is already forwarded in `forwardHeaders()`, so Multer receives a correct multipart stream.

## Final client upload format

- **JPEG** (avatar preset) — browser canvas JPEG is reliable and compact.

## Final backend storage format

- **WebP 512×512** (cover, quality 82) — via `optimizeProfilePhotoFile` in `media.processor.ts` (unchanged).

## Key file changed

| File | Change |
|------|--------|
| `bpa_web/app/api/v1/[[...path]]/route.js` | `request.arrayBuffer()` instead of `request.text()` for non-GET bodies |

## Supporting changes (already in place from earlier sessions)

| File | Change |
|------|--------|
| `bpa_web/src/media/cropper/ImageCropperModal.tsx` | Uses `cropImageToBlob` (correct react-easy-crop coordinates); `cropError` UI |
| `bpa_web/src/media/cropper/config-presets.ts` | AVATAR preset `format: "jpg"` |
| `backend-api/src/api/v1/modules/media/media.processor.ts` | `optimizeProfilePhotoFile` with metadata probe + `INVALID_IMAGE_PAYLOAD` code |
| `backend-api/src/api/v1/modules/me/meProfile.service.ts` | Maps `INVALID_IMAGE_PAYLOAD` → 400 |

## Test cases to verify

1. Upload/crop JPG source → success; stored WebP avatar.
2. Upload/crop PNG source → success.
3. Cancel crop → no upload, no error state.
4. Retry after failure → works.
5. Remove photo → works.
6. Account Hub + header avatar refresh → `bpa:me-refresh` → `useMe` re-fetches.
