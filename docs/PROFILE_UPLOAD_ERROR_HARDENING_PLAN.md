# Profile photo upload — error hardening

**Path:** `D:/BPA_Data/backend-api/docs/PROFILE_UPLOAD_ERROR_HARDENING_PLAN.md`

## Root cause (observed)

- **Multer `LIMIT_FILE_SIZE`** was thrown when the uploaded file exceeded the in-memory limit. Errors reached the global handler as raw `MulterError` values without a stable **`success` / `code` / `meta`** contract, so clients could show generic failures or poor UX.
- The profile route did not use a **multer error wrapper**, so `next(err)` relied on generic error formatting.
- **No `fileFilter`** was applied on the profile uploader, so non-image MIME types could reach processing until downstream steps.
- **Frontend** did not pre-validate size/type or surface structured **`code`** from the API.

## Policy

| Item | Value |
|------|--------|
| Max size | **8 MB** (`PROFILE_PHOTO_MAX_MB` / `PROFILE_PHOTO_MAX_BYTES`) |
| Allowed MIME types | `image/jpeg`, `image/png`, `image/webp` only (GIF intentionally excluded for profile avatars) |
| Form field | `file` (single file) |

## Backend error contract

JSON shape for failures:

```json
{
  "success": false,
  "message": "Human-readable message",
  "code": "FILE_TOO_LARGE | INVALID_FILE_TYPE | FILE_REQUIRED | FILE_UPLOAD_FAILED | INVALID_MULTIPART_PAYLOAD",
  "meta": { "maxSizeMb": 8 }
}
```

- **`meta`** may be omitted; included for `FILE_TOO_LARGE` when applicable.
- Stack traces are **not** included in JSON responses (unchanged: dev-only server logging).

## Implementation notes

- **`profilePhotoUpload.config.ts`** — shared limits and MIME allowlist.
- **`profilePhotoUpload.middleware.ts`** — multer (memory, limit, `fileFilter`) + **`runProfilePhotoUpload`** wrapper that normalizes multer errors before `next(err)`.
- **`me.routes.ts`** — uses `runProfilePhotoUpload` instead of bare `uploadAvatar.single("file")`.
- **`meProfile.service.ts`** — empty buffer, MIME re-check, **Sharp metadata** validation (blocks renamed non-images), try/catch around processing/storage with `FILE_UPLOAD_FAILED`.
- **`meProfile.controller.ts`** — returns `code` / `meta` on structured failures.
- **`errors.ts`** — attaches `code` / `meta` from thrown errors; **fallback** mapping for unwrapped `MulterError` on any route.

## Frontend (`bpa_web`)

- **`MeApiError`** in `meProfileApi.ts` — preserves `code` and `meta` from API JSON.
- **`AccountHubPage`** — helper text (accepted types, max size), client-side size/type checks, `photoUploading` / `removingPhoto` flags, disabled controls during operations, user-friendly messages by `code`.

## Test cases

| # | Case | Expected |
|---|------|----------|
| 1 | Valid JPG &lt; 8 MB | 200, profile updated |
| 2 | Valid PNG &lt; 8 MB | 200 |
| 3 | File &gt; 8 MB | 400, `FILE_TOO_LARGE`, clear message |
| 4 | PDF / EXE / non-image (or spoofed) | 400, `INVALID_FILE_TYPE` (multer and/or Sharp) |
| 5 | No file in field | 400, `FILE_REQUIRED` |
| 6 | Retry after failure | Upload works; UI not stuck loading |
| 7 | DELETE profile photo | Still works |
| 8 | Header/dropdown after failed upload | No broken avatar state (no optimistic URL change) |

---

**Updated:** `D:/BPA_Data/backend-api/docs/PROFILE_UPLOAD_ERROR_HARDENING_PLAN.md`
