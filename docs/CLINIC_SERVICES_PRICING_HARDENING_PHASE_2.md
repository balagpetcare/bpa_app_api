# Clinic Services & Pricing — Hardening Phase 2 (rollout plan)

**Status:** Planning / hardening checklist (does not replace `CLINIC_SERVICES_PRICING_ENTERPRISE.md`).
**Baseline:** Current implementation in `bpa_web` + `backend-api` as of repo state when this doc was authored.
**Scope:** Complete enterprise rollout, stabilize routes/runtime, align nav, close UI/API gaps — **no architecture redesign**.

---

## 1. Current implemented state

### Staff frontend (`bpa_web`)

| Area | State |
|------|--------|
| **Canonical staff URLs** | Flat segments under `.../clinic/`: `services-pricing-catalog`, `services-pricing-matrix`, `services-pricing-agreements`. |
| **Legacy nested URLs** | `.../services-pricing/catalog`, `/matrix`, `/agreements` → redirected in `next.config.js` to the flat routes (Turbopack / nested dynamic stability). |
| **Shared nav** | `app/staff/(larkon)/branch/[branchId]/clinic/_components/ServicesPricingNav.tsx` — pills for catalog, matrix, agreements, plus link to branch **Catalog** with `?tab=packages`. |
| **Nested layout** | `services-pricing/layout.tsx` still wraps **only** the subtree under `services-pricing/` (e.g. service content page); flat catalog/matrix/agreements pages live **outside** that folder and mount nav explicitly where needed. |
| **Service content / media** | `.../clinic/services-pricing/services/[serviceId]/content` — edits content fields via `PATCH .../services/:id/pricing`, loads/saves media via `GET/PUT .../services/:id/media`. Back links target flat `services-pricing-catalog`. |
| **Branch sidebar** | `src/lib/branchSidebarConfig.ts` — “Services & Pricing” group: catalog, matrix, agreements (flat URLs), packages → `/staff/branch/:id/clinic/catalog?tab=packages`. |
| **Top-level permission menu** | `src/lib/permissionMenu.ts` — staff branch-scoped items are **not** duplicated here; comment notes branch sidebar drives clinic IA. Doctor panel includes “Service fees & pricing” → `/doctor/service-fees`. |

### Backend (`backend-api`)

| Area | State |
|------|--------|
| **Matrix** | `GET /api/v1/clinic/branches/:branchId/service-pricing/matrix` — `clinic.controller.getServicePricingMatrix` → `servicePricing.service.getServicePricingMatrix`. |
| **Pricing PATCH** | `PATCH /api/v1/clinic/branches/:branchId/services/:serviceId/pricing` — `patchClinicServicePricing`. |
| **Pricing history** | `GET .../services/:serviceId/pricing-history` — `getServicePricingHistory`. |
| **Service media** | `GET` + `PUT .../services/:serviceId/media`. |
| **Doctor fee history (staff)** | `GET .../doctors/:memberId/fee-history` — `getDoctorFeeHistory`. |
| **v1 router** | `src/api/v1/routes.ts` registers matrix **before** `router.use("/clinic", ...)` (same pattern as clinical-overview) to reduce “route not found” when `dist` is partial. |
| **Express hard-mount** | `src/app.ts` registers matrix, pricing-history, pricing PATCH, media GET/PUT, and fee-history **on `app` before** the v1 router — defense in depth for `npm start` + stale `dist`. |
| **Clinic routes** | `clinic.routes.ts` still declares the same service-pricing/service routes for clarity and `npm run dev` parity. |

### Doctor panel (`bpa_web`)

- **`/doctor/service-fees`** — loads `doctorGetMyServices(branchId)`, acknowledge via `doctorPostMyServicesAcknowledge` (aligns with “pending ack” data shown in matrix where applicable).
- Legacy **`/doctor/services-management`** redirects to `/doctor/service-fees`.

### API client (`bpa_web/lib/api.ts`)

- `staffClinicServicePricingMatrix`, `staffClinicPatchServicePricing`, `staffClinicListServiceMedia`, `staffClinicPutServiceMedia`, `staffClinicGetServiceById` — paths align with backend routes above.
- **No** `staffClinic*` helper found for `pricing-history` in a repo search at authoring time (endpoint may be unused by staff UI).

---

## 2. What is complete

- Staff **catalog** (list + edit modal + matrix-backed load), **matrix** (read-only aggregate + fee rows), **agreements** stub (client redirect to `.../doctors/service-assignment`).
- **Next.js** flat routes + **redirects** for legacy nested catalog/matrix/agreements.
- **Backend** handlers and **triple registration** pattern (early `routes.ts` + `clinic.routes.ts` + `app.ts` hard-mount for critical paths) for matrix and related service-pricing endpoints.
- **Service content** page: pricing patch + media list/order + notes/FAQ.
- **Doctor** service fees page + acknowledge API usage.
- **Operational doc** `docs/DEV_API_RUN_AND_DIST.md` explains `npm run dev` vs `npm start` and stale `dist` 404s.

---

## 3. What is still incomplete or risky

| Item | Risk / gap |
|------|------------|
| **Nested content URL** | `.../services-pricing/services/:serviceId/content` remains **deep nested** — same Turbopack class as pre-fix catalog/matrix; may 404 in some dev builds. |
| **Pricing history UI** | Backend + hard-mount exist; **staff UI** does not appear to call `.../pricing-history` (no client helper grep hit). Auditors/managers lack in-app history timeline unless added. |
| **Fee history UI** | Staff API exists; confirm **doctor ops / staff doctor profile** screens wire `fee-history` where product expects a visible timeline (grep-driven gap if missing). |
| **Packages pill vs sidebar** | Nav “Packages” and sidebar item point at **branch Catalog** (`/clinic/catalog?tab=packages`), not `services-pricing-catalog` — intentional cross-link; verify `catalog` page honors `tab=packages` and permissions match copy. |
| **Duplicate route registration** | Matrix and siblings registered in multiple layers — correct for reliability but increases **drift** risk if one path is edited without the others; needs a short “touch list” in PR checklist. |
| **`dist` / CI** | Production or `npm start` without fresh `build` can still 404 if someone removes hard-mounts or early `routes.ts` entries without rebuilding. |

---

## 4. Required route stabilization tasks

1. **Content page (optional follow-up):** If `.../services-pricing/services/:id/content` 404s in target environments, add a **flat** canonical route (e.g. `services-pricing-service-content/[serviceId]`) and **redirect** from the nested path — mirror catalog/matrix/agreements pattern; keep a single page component or re-export to avoid duplicate logic.
2. **Verify redirects** after any Next upgrade: `next.config.js` redirect ordering and `:branchId` segment behavior unchanged.
3. **Smoke test** both URL shapes: flat direct hit + legacy nested → redirect.

---

## 5. Required sidebar / nav cleanup

1. **Consistency check:** Ensure every entry in `ServicesPricingNav` and `branchSidebarConfig` “Services & Pricing” group uses the **same** canonical paths (already flat for catalog/matrix/agreements).
2. **Active state:** Nav already treats flat + legacy path substrings for pills; after any new flat route for content, extend active detection if a pill is added.
3. **permissionMenu:** No change required unless product wants staff S&P links duplicated at non-branch root (currently deferred to branch sidebar — document as intentional).

---

## 6. Required page completion tasks

1. **Pricing history (staff):** Add read-only UI (modal or section) on catalog row or service detail that calls `GET .../services/:serviceId/pricing-history`; add `lib/api.ts` helper if missing.
2. **Fee history (staff):** Where doctor fee disputes are reviewed, wire `GET .../doctors/:memberId/fee-history` if not already present.
3. **Packages:** Confirm UX when user lands from S&P nav on `catalog?tab=packages` (tab selection, empty state, permissions).

---

## 7. Required backend runtime reliability tasks

1. **Keep** early registration in `src/api/v1/routes.ts` and **hard-mounts** in `src/app.ts` in sync with `clinic.routes.ts` for: matrix, pricing-history, pricing PATCH, media GET/PUT, fee-history (same paths and permission middleware intent).
2. **CI / release:** Ensure `npm run build` runs clean before packaging; document that removing hard-mounts requires a full regression of `npm start`.
3. **Optional:** Add a lightweight integration test or script that asserts these routes respond (401 without token is enough) to catch mount regressions.

---

## 8. Verification checklist

- [ ] `GET /api/v1/clinic/branches/:branchId/service-pricing/matrix` — 200 with valid staff token and branch scope (or expected 403).
- [ ] `PATCH .../services/:serviceId/pricing` — catalog edit + content save still succeed.
- [ ] `GET/PUT .../services/:serviceId/media` — content page load/save.
- [ ] `GET .../services/:serviceId/pricing-history` — callable (Postman/curl); staff UI if implemented.
- [ ] `GET .../doctors/:memberId/fee-history` — callable; linked from UI if required.
- [ ] Staff: flat URLs load without 404; legacy nested URLs **redirect** to flat.
- [ ] Doctor: `/doctor/service-fees` loads services + acknowledge works.
- [ ] `npm run dev` (API) and `npm start` after `npm run build` both expose the same matrix path.

---

## 9. Rollout order (recommended)

1. **Runtime proof** — Run checklist §8 in staging with fresh API build (`npm run build` + `npm start`).
2. **Frontend nested content** — Only if 404 reproduced: flat route + redirect for service content.
3. **Staff pricing history UI** — API already present; lowest risk enterprise polish.
4. **Fee history surfacing** — Where operational workflows need it.
5. **Docs / onboarding** — Link this hardening doc from internal wiki or `DEV_API_RUN_AND_DIST.md` “See also” (optional one-line).

---

## 10. Risks / fallback notes

| Risk | Mitigation |
|------|------------|
| **Stale `dist`** | Prefer `npm run dev` locally; production pipeline must run `build`. See `DEV_API_RUN_AND_DIST.md`. |
| **Triple registration drift** | Any change to path or handler: update `clinic.routes.ts`, `routes.ts` (if used), and `app.ts` hard-mount together. |
| **Turbopack nested 404** | Flatten + redirect; do not rely on “file exists” for deep `app/staff/.../dynamic/.../nested` segments. |
| **Permission mismatch** | Matrix uses a union of pricing/service/appointment perms; keep staff UI `PERMS` arrays aligned with backend `requireClinicPermission` sets when adding new screens. |

---

## Prioritized implementation checklist (short)

| Priority | Task |
|----------|------|
| P0 | Confirm matrix + PATCH + media + fee-history respond under `npm start` after clean build; fix mounts only if checklist fails. |
| P1 | If content URL 404s in dev: flat `services-pricing` content route + `next.config.js` redirect. |
| P2 | Add staff UI + `lib/api.ts` for **pricing-history**. |
| P3 | Audit staff doctor UI for **fee-history** consumption; wire if missing. |
| P4 | Validate **packages** tab entry from S&P nav vs `branchSidebarConfig`. |
| P5 | Optional CI route probe or doc cross-links. |

---

**Doc path:** `backend-api/docs/CLINIC_SERVICES_PRICING_HARDENING_PHASE_2.md`
