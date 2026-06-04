# Social Login Profile Bootstrap & Photo Sync

**Path:** `D:/BPA_Data/backend-api/docs/SOCIAL_LOGIN_PROFILE_BOOTSTRAP_AND_PHOTO_SYNC_PLAN.md`

## Phase 1 — Audit summary

### Current state (before this work)

- **AuthProvider** (`LOCAL`, `GOOGLE`, `FACEBOOK`, `APPLE`) exists on `UserAuth`; **no Twitter/X** in enum initially.
- **No OAuth callback routes** were present in the API; registration/login paths created **LOCAL** users with password.
- **UserProfile** stores manual avatar via `avatarMediaId` → `Media` (MinIO-backed URLs).
- **Enterprise hub** (`/api/v1/me/profile`) returned manual `profilePhoto` from `avatarMedia` only.
- **google-auth-library** is already a backend dependency (usable for `id_token` verification).

### Unsupported / not in codebase

- **WhatsApp OAuth** — not part of `AuthProvider` or auth routes; **not implemented** (by design).
- **Facebook / Apple / X sign-in** — no verified token flow in repo; **stubs** return HTTP 501 with a clear message until client IDs and verification are configured.

### Supported after implementation

- **Google** — `POST /api/v1/auth/oauth/google` with `{ "idToken": "..." }` verifies the token (requires `GOOGLE_CLIENT_ID`), creates or signs in the user, runs provider bootstrap, issues JWT + cookie (same pattern as password login).

---

## Design

### Storage (additive)

**`UserProfile`**

- `providerDisplayName` — last known display name from OAuth provider.
- `providerAvatarUrl` — HTTPS URL from provider (reference only; not overwritten by manual upload).
- `providerKey` — e.g. `GOOGLE`, `FACEBOOK` (last sync source).
- `providerSyncedAt` — timestamp of last provider metadata write.

**`UserAuth`**

- `oauthSubject` — OIDC `sub` (e.g. Google), for account linkage and idempotency.

**`AuthProvider` enum**

- Add **`TWITTER`** for future X/Twitter OAuth (additive).

### Name rules

- Bootstrap may set `UserProfile.displayName` from provider **only if** current name is a **placeholder** (`empty`, `New User`, `user`, `bpa staff`, case-insensitive).
- Otherwise **displayName is not overwritten** on subsequent logins.
- `providerDisplayName` is **always refreshed** on successful provider sync (metadata only).

### Photo priority (mandatory)

1. **MANUAL** — `avatarMediaId` set → `manualPhotoUrl` / effective = uploaded media URL.
2. **PROVIDER** — no manual avatar → use `providerAvatarUrl` if present.
3. **NONE** — no URLs → effective null (UI uses initials/default).

Removing manual photo (`DELETE /api/v1/me/profile/photo`) disconnects media → falls back to provider URL if any.

### API (backward compatible)

- **`GET /api/v1/me/profile`** — `basic` includes:
  `manualPhotoUrl`, `providerPhotoUrl`, `effectivePhotoUrl`, `photoSource`, `providerDisplayName` (read-only provider label).
- **`GET /api/v1/auth/me`** — profile object enriched with the same effective-photo fields (additive JSON keys on `profile`).
- **`PATCH /api/v1/me/profile`** — **rejects** client-supplied `providerAvatarUrl` / `providerDisplayName` / `providerKey` (provider data only via OAuth/bootstrap).
- **`POST /api/v1/me/profile/photo`** — multipart `file` → MinIO media → connect as avatar; audit `PROFILE_PHOTO_UPDATED`.
- **`DELETE /api/v1/me/profile/photo`** — disconnect manual avatar; audit `PROFILE_PHOTO_REMOVED`.

### Audit

- `PROFILE_BOOTSTRAPPED_FROM_PROVIDER` — first provider sync for the user.
- `PROVIDER_PROFILE_SYNCED` — subsequent provider metadata refresh.
- Existing: `PROFILE_PHOTO_UPDATED`, `PROFILE_PHOTO_REMOVED` (legacy strings preserved where applicable).

### Security

- Provider URLs stored as references; **no** silent overwrite of manual `avatarMedia`.
- OAuth endpoint verifies **Google ID tokens** server-side only.
- Self-service PATCH cannot set provider snapshot fields.

### Rollback

- New columns nullable; old clients ignore new JSON keys.
- Disable Google endpoint by unsetting `GOOGLE_CLIENT_ID`.

### Frontend (bpa_web)

- **Account Hub** (`AccountHubPage`): Overview tab shows profile photo preview, `photoSource` badge (uploaded / social / default), upload/change via `POST /api/v1/me/profile/photo` (multipart `file`), remove via `DELETE /api/v1/me/profile/photo` when `photoSource === MANUAL`. Short copy explains social fallback. Basic tab shows read-only **Name from your sign-in provider** when `providerDisplayName` is set.
- **Header / dropdown**: `TopProfileMenu` and Larkon `ProfileDropdown` prefer `profile.effectivePhotoUrl`, then `avatarMedia.url`. Fixed 32×32 container to avoid layout shift.
- **Session refresh**: After upload/remove, the hub dispatches `bpa:me-refresh`; `useMe` listens and refetches `/api/v1/auth/me` so topbar avatars update without a full page reload.

---

**Updated:** `D:/BPA_Data/backend-api/docs/SOCIAL_LOGIN_PROFILE_BOOTSTRAP_AND_PHOTO_SYNC_PLAN.md`
