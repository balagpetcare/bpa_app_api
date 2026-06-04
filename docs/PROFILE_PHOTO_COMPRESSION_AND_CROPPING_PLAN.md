# Profile photo compression and cropping plan

## Audit results (Phase 1)

### Frontend

| Capability | Finding |
|------------|---------|
| Larkon / shared cropper | **Yes.** `src/media/cropper/ImageCropperModal.tsx` uses `react-easy-crop` (zoom, rotate, square aspect via config). `useImageCropper` exposes `openCropper(file, config) → Promise<CropResult \| null>`. |
| Presets | **`getCropperConfig("avatar")`** in `src/media/cropper/config-presets.ts` — fixed 1:1, WebP output up to 512×512 client-side. |
| Other croppers | `ImageUploadWithCrop.jsx`, `app/owner/_components/branch/ImageUploadField.tsx`, `src/bpa/components/media/ImageUploadCard.jsx` — redundant; **not** used for account hub. |
| Compression | **Client:** crop modal encodes to WebP/JPEG/PNG per preset (`ImageCropperModal` `cropToBlob`). **No** separate `browser-image-compression` library. |
| Upload helpers | `src/lib/meProfileApi.ts` (`mePostForm`), `src/lib/profilePhotoUpload.ts` (limits + MIME allowlist). |
| Docs | `bpa_web/docs/IMAGE_CROPPER_SYSTEM.md` describes the unified cropper + `ImageUploader`. |

### Backend

| Capability | Finding |
|------------|---------|
| Image pipeline | **`sharp`** in `src/api/v1/modules/media/media.processor.ts` — `optimizeImage()` for generic uploads (resize inside max side, JPEG). |
| Profile photo route | **`POST /api/v1/me/profile/photo`**, **`DELETE /api/v1/me/profile/photo`** — `me.routes.ts`; handlers in `meProfile.controller.ts`, logic in `meProfile.service.ts`. |
| Multer | `profilePhotoUpload.middleware.ts` + `profilePhotoUpload.config.ts` (8 MB, JPG/PNG/WEBP). |
| Storage | `media.service.ts` — S3/MinIO `uploadAndCreateMedia`, `deleteMyMedia` (soft delete + object delete). |

### Reuse decision (Cases A–D)

**Case A-adjacent:** Shared cropper + server `sharp` already existed. **Implemented:** reuse **`useImageCropper` + `getCropperConfig("avatar")`** in Account Hub; add **dedicated** `optimizeProfilePhotoFile()` in `media.processor.ts` for avatar-sized WebP (instead of generic `processUploadFile` JPEG @ 1600px).

---

## Chosen approach

### Compression

1. **Client:** Avatar preset outputs **WebP** (quality 0.9 in preset) at max **512×512** in the crop modal (`ImageCropperModal`).
2. **Server:** **`optimizeProfilePhotoFile`** — `sharp`: `rotate()` → `resize(512, 512, { fit: "cover", position: "attention" })` → `webp({ quality: 82 })`. Ensures stored object is small and normalized even if the client sends a large or unusual payload.
3. **Env overrides:** `PROFILE_PHOTO_MAX_SIDE` (default `512`), `PROFILE_PHOTO_WEBP_QUALITY` (default `82`).

### Output size / format policy

| Stage | Policy |
|-------|--------|
| Stored file | **WebP**, square **512×512** (cover), quality **82** (configurable). |
| Client crop | **1:1**, WebP from preset, max 512×512 in crop output settings. |

### Storage cleanup

- **Replace:** After linking the new `Media` row, **delete previous avatar media** via `deleteMyMedia` when the old `avatarMediaId` differs from the new id (non-fatal on failure).
- **Remove:** After `disconnect`, **delete** prior avatar media when present (non-fatal on failure).

### Endpoints (unchanged paths)

- `POST /api/v1/me/profile/photo` — multipart field `file`; returns updated enterprise profile.
- `DELETE /api/v1/me/profile/photo` — removes manual avatar link and cleans storage when possible.

### Audit events (unchanged)

- `PROFILE_PHOTO_UPDATED` — successful upload.
- `PROFILE_PHOTO_REMOVED` — user removed uploaded photo.

---

## Frontend crop flow (Account Hub)

1. User chooses **Upload or change photo** → file input.
2. Validate type/size (same limits as backend pre-crop).
3. **`openCropper(file, getCropperConfig("avatar"))`** — modal: square crop, zoom, rotate; Cancel → `null`, no state break.
4. On confirm → upload **`cropped.file`** via `FormData` to `/profile/photo`.
5. On success → `loadAll()` + `window.dispatchEvent('bpa:me-refresh')` for header / `useMe` consumers.

---

## Rollout notes

- **Non-breaking:** Route shape and auth unchanged; manual photo remains highest-priority avatar source in existing resolution logic.
- **Backward compatible:** Old avatars (JPEG/PNG URLs) still display; new uploads trend to WebP URLs.
- **Testing:** See task checklist (large image crop, invalid type, remove, header refresh, layout stability).

---

## Files touched (implementation)

| Area | File |
|------|------|
| Backend | `src/api/v1/modules/media/media.processor.ts` — `optimizeProfilePhotoFile` |
| Backend | `src/api/v1/modules/me/meProfile.service.ts` — use optimizer; cleanup old media on replace/remove |
| Frontend | `src/components/account/AccountHubPage.tsx` — cropper integration |
| Frontend | `src/media/cropper/config-presets.ts` — AVATAR `maxFileMB` aligned to 8 (policy doc; preset metadata) |
| Frontend | `src/media/cropper/ImageCropperModal.tsx` — remove debug `console.log` |

---

## Hardening & UI stability (follow-up)

### Gaps addressed

| Gap | Mitigation |
|-----|------------|
| Topbar profile dropdown “jumps” / scroll on open | **Root cause:** `DropdownToggle as="a"` behaves like a link; Bootstrap/React-Bootstrap often implies `href="#"` semantics → **scroll to top** (felt as upward movement). **Fix:** `DropdownToggle as="button" type="button"` with `aria-label` / `aria-haspopup="menu"`. |
| Avatar layout shift (load / refresh) | Fixed **32×32** (Larkon `ProfileDropdown`) and **34×34** (owner `TopProfileMenu`) slots with explicit `width`/`height`, `flexShrink: 0`, `decoding="async"`, and **removing** `stopPropagation` on the avatar `<img>` in `TopProfileMenu` so the whole control toggles reliably. |
| Stale `/auth/me` after upload | `useMe` `fetch` now uses **`cache: 'no-store'`** so browsers do not serve cached identity after `bpa:me-refresh`. |
| Account Hub edge cases | Empty file rejection; **try/catch** around `openCropper`; **`messageFromMeDeleteError`** for structured delete errors; **image `key`** on hub preview when URL/source changes. |

### Panel coverage

- **Larkon panels** (owner / staff / clinic / doctor / …) use `ProfileDropdown` in `TopNavigationBar/page.tsx` → one fix covers all.
- **Legacy owner topbar** (`app/owner/layout.tsx`) uses `TopProfileMenu` → avatar slot + fetch cache aligned there.

### Cancel / retry UX

- Crop **Cancel** still resolves `openCropper` with `null` → no upload, no error toast (unchanged).
- Failed upload shows API-aligned messages; user can pick **Upload or change photo** again (input reset after each pick).
