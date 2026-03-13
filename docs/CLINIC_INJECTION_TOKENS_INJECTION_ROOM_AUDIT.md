# Clinic Injection Tokens & Injection Room — Enterprise Upgrade Audit (Phase 1)

**Scope:** Staff medicine-control pages  
- `/staff/branch/[branchId]/clinic/medicine-control/injection-tokens`  
- `/staff/branch/[branchId]/clinic/medicine-control/injection-room`  

**Audit type:** Analysis only — no code changes.  
**Date:** 2026-03-14.

---

## A. CURRENT IMPLEMENTATION INVENTORY

### A.1 Frontend — Routes, Pages, Components, Hooks, API, State

| Area | Location | Purpose |
|------|----------|---------|
| **Injection Tokens page** | `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/medicine-control/injection-tokens/page.tsx` | Single page: generate form, validate input, token list table with status filter, token code search, cancel action. All UI inline; no sub-components. |
| **Injection Room page** | `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/medicine-control/injection-room/page.tsx` | Single page: Step 1 validate token (code input + result), Step 2 record dose form (patient/visit/variant/dose/vial session/unit/route/source/emergency bypass). Token context (treatment course, selected vial) shown when available. All inline. |
| **Medicine Control dashboard** | `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/medicine-control/page.jsx` | Dashboard with stats (issued today, returns, active vials, approvals, **tokens generated**, flagged recon) and quick links to injection-tokens, injection-room, etc. Uses `apiGet(…/medicine-control/dashboard/branch)`. |
| **Active Vials page** | `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/medicine-control/active-vials/page.jsx` | Lists vial sessions (id, variant, initial/remaining, opened, status). Uses `staffClinicVialSessionsList(branchId)`. Not shared as a component with injection-room. |
| **Parent layout** | `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/layout.jsx` | Gates on branch type, `clinicEnabled`, and clinic permissions; no medicine-control–specific layout. |
| **Shared components** | `bpa_web/src/components/branch/BranchHeader.jsx`, `AccessDenied.jsx`, `PermissionGate.jsx` | Branch chrome and access denial only. No shared clinic/injection components. |
| **API layer** | `bpa_web/lib/api.ts` | All staff clinic medicine-control calls: `staffClinicGenerateInjectionToken`, `staffClinicValidateInjectionToken`, `staffClinicInjectionTokensList`, `staffClinicCancelInjectionToken`, `staffClinicInjectionTokenWithContext`, `staffClinicRecordDose`, `staffClinicVialSessionsList`, `staffClinicInjectionMonitor`, etc. |
| **Nav / permissions** | `bpa_web/src/lib/branchSidebarConfig.ts`, `permissionMenu.ts` | Sidebar links and permission menu entries for medicine-control, injection tokens, injection room. |

**State handling (summary):**

- **Injection-tokens:** `list`, `total`, `loading`, `statusFilter`, `tokenFilter`, `actingId`; generate form state (`visitId`, `variantId`, `expectedDose`, `unit`, `medicineSource`, `expiresInHours`, `creating`); validate state (`validateCode`, `validateResult`, `validating`). No global store; all local `useState`/`useCallback`/`useEffect`.
- **Injection-room:** `tokenCode`, `tokenPayload`, `tokenContext`, `validating`; dose form state (`patientId`, `visitId`, `variantId`, `administeredDose`, `prescribedDose`, `unit`, `route`, `vialSessionId`, `medicineSource`, `emergencyBypass`, `saving`). Token context loaded asynchronously after validate via `staffClinicInjectionTokenWithContext(branchId, token.id)`.

### A.2 Backend — Routes, Controllers, Services, DTOs, Prisma, Permissions

| Layer | File(s) | Purpose |
|-------|---------|---------|
| **Routes** | `backend-api/src/api/v1/modules/clinic/clinic.routes.ts` | Under `/branches/:branchId/medicine-control/`: `POST /injection-token`, `GET /injection-token/validate`, `GET /injection-tokens`, `PATCH /injection-token/:id/cancel`, `GET /injection-token/:id/context`, `POST /dose`, `GET /dose/visit/:visitId`, `GET /vial-sessions`, plus dispense, return, override, reconciliation, dashboards. |
| **Controller** | `backend-api/src/api/v1/modules/clinic/clinic.controller.ts` | `generateInjectionToken`, `validateInjectionToken`, `cancelInjectionToken`, `listInjectionTokens`, `getInjectionTokenWithContext`, `recordDose`, `getDoseByVisit`; all use `sendClinicSuccess`/`sendClinicError` with `res.data` payload. |
| **Injection token service** | `backend-api/src/api/v1/modules/clinic/injectionToken.service.ts` | `GenerateTokenInput`, `ListTokenOptions`; `generateToken`, `getTokenWithTreatmentContext`, `validateToken`, `getUsableTokenById`, `consumeToken`, `cancelToken`, `listTokens`, `expireStaleTokens`. Branch policy `tokenValiditySameDayOnly` applied at **generation** (expiresAt set to EOD). |
| **Dose consumption service** | `backend-api/src/api/v1/modules/clinic/doseConsumption.service.ts` | `RecordAdministrationInput`; `recordAdministration` (creates `MedicationAdministration`, optionally decrements vial via `openVialService.recordDose`, consumes token, updates treatment day item). Enforces token when not emergency bypass; OUTSIDE source requires pharmacy receive; EXTERNAL rejected. |
| **Open vial service** | `backend-api/src/api/v1/modules/clinic/openVial.service.ts` | `recordDose(sessionId, { quantityDelta, … })`, `listSessions`, `closeSession`, etc. Used by dose consumption when `vialSessionId` present. |
| **Exception override** | `backend-api/src/api/v1/modules/clinic/exceptionOverride.service.ts` | `requestSupervisorOverride`, `approveOverride` (MedicineApprovalRequest). Used for expired vial / insufficient ml / missed day — **not** used by current injection-room UI (injection-room uses "emergency bypass" = record without token, permission-gated). |
| **Responses** | `backend-api/src/api/v1/modules/clinic/clinic.responses.ts` | `sendClinicSuccess(res, statusCode, data, message)` → `{ success: true, data, message? }`. |
| **Prisma models** | `backend-api/prisma/schema.prisma` | `InjectionToken` (tokenCode, branchId, visitId, variantId, status, expiresAt, selectedVialSessionId, treatmentCourseId, treatmentDayId, …); `MedicationAdministration` (dose record; links to injectionToken, vialSession); `VialSession`, `VialSessionEvent`; `MedicineApprovalRequest` (override workflow). Enums: `InjectionTokenStatus`, `MedicineSource`, `VialSessionStatus`, `VialEventType`. |
| **Permissions** | `backend-api/src/api/v1/services/permissionsRegistry.service.ts`, `seedRolesPermissions.ts`, `branchRoles.ts` | Medicine control: `injection.token.generate`, `injection.token.validate`, `injection.token.list`, `injection.token.cancel`, `injection.token.emergency_bypass`, `medicine.dose.record`, `medicine.dose.read`, `medicine.vial.*`, `medicine.override.approve`, etc. |

**DTOs / validators:** No separate DTO files. Input types live in services (`GenerateTokenInput`, `ListTokenOptions`, `RecordAdministrationInput`). Controller reads `req.body`/`req.query`/`req.params` and maps to service calls.

---

## B. WORKFLOW CAPABILITY CHECK

| Capability | Status | Notes |
|------------|--------|-------|
| Token generation from visit/prescription | **Implemented** | Backend: visit + paid order + variant + expectedDose; frontend generate form (visitId, variantId, dose, unit, expire, source). Treatment course / day / selectedVialSessionId supported in service but **not** passed from controller or UI. |
| Token validity / expiry | **Implemented** | Backend: `expiresAt` set at generation; branch policy `tokenValiditySameDayOnly` can force EOD. Validate checks `expiresAt` and marks PENDING→EXPIRED. |
| Token status lifecycle | **Implemented** | PENDING → USED (on record dose) or EXPIRED or CANCELLED. Consume/cancel in service; list and table show status. |
| Token list with filters/search | **Partially implemented** | Backend: status, visitId, patientId, tokenCode (contains), fromDate, toDate, skip, take. Frontend uses status + tokenCode only; no date range, no pagination UI (take=100). |
| Token details / audit | **Partially implemented** | List row shows tokenCode, visitId, variant, dose, status, createdAt. No dedicated token detail or audit trail UI. Backend has no dedicated "token audit" endpoint (list + context give what exists). |
| Token validation | **Implemented** | Validate by code; returns `{ valid, reason?, token? }`. Frontend uses `result.token`; on success fetches context for injection-room. |
| Injection execution recording | **Implemented** | `recordDose` with patientId, variantId, administeredDose, visitId, vialSessionId, injectionTokenId, medicineSource, prescribedDose, unit, route, emergencyBypass. Backend creates MedicationAdministration, consumes token, decrements vial. |
| Vial session selection / remaining ml | **Partially implemented** | Token can have `selectedVialSessionId` (from billing/generate); context returns `selectedVialSession` with remainingQty/validUntil. Injection-room shows selected vial in context but **vialSessionId** is a free-text input; no dropdown of active vials for this variant. |
| Partial vs full dose handling | **Partially implemented** | Backend supports prescribedDose vs administeredDose and decrements vial by administeredDose. No explicit "partial dose" UX or validation (e.g. max allowed vs remaining). |
| Emergency bypass / override approval | **Mixed** | **Emergency bypass:** Implemented — permission `injection.token.emergency_bypass`, checkbox on injection-room, record without token. **Override approval** (expired vial, insufficient ml, etc.): Backend has exceptionOverride flow; **not** wired in injection-room UI. |
| Permission enforcement | **Implemented** | Routes use `requireClinicPermission(...)`. Frontend gates with PERMS arrays and AccessDenied. |
| Audit log creation | **Partially implemented** | MedicationAdministration and token consume are persisted; exception override writes audit. No dedicated "injection audit" API or UI for these two pages. |
| Branch / room safety rules | **Partially implemented** | Token and dose are branch-scoped. Room is not enforced in current injection-room flow (no roomId on dose or token in UI). |
| Response shape consistency | **Implemented** | Backend sends `{ success, data }`; frontend uses `res?.data`. List: `{ list, total }`; validate: `{ valid, token }`; context: token object with nested treatmentCourse, treatmentDay, selectedVialSession. Aligned. |

---

## C. UX / UI GAP REVIEW

Current UI is **functional but not enterprise-ready**. Gaps:

| Element | Current | Gap |
|---------|---------|-----|
| **Dashboard stats** | Medicine-control dashboard has "Tokens generated" and links. | Injection-tokens and injection-room pages have **no** local stats (e.g. pending count, used today, expired today). |
| **Workflow stepper** | Injection-room has "Step 1 / Step 2" labels. | No visual stepper; no clear "next step" or completion state; no back/clear. |
| **Patient/prescription summary cards** | After validate, injection-room shows plain text (visit, patient, variant, dose, status). | No card layout; no patient/pet name from context; no prescription or order summary. |
| **Active vial info panel** | Context shows "Selected vial session: #id". | No remaining ml, validUntil, or variant name in a dedicated panel; vialSessionId is manual input. |
| **Audit drawer** | None. | No "view audit" or "dose history for this visit/token" on either page. |
| **Queue/history tabs** | Injection-tokens is a single table. | No "Pending queue" vs "History" tabs; no "today's injections" view on injection-room. |
| **Empty/loading/error states** | Loading spinner; "No injection tokens found"; toast on error. | Generic; no illustration or recovery CTA; no inline field-level errors. |
| **Permission-based actions** | Buttons hidden by canGenerate/canValidate/canCancel/canBypass. | Good. Missing: disabled tooltips or explanation when permission missing. |
| **Dangerous action confirmations** | Cancel token: `confirm("Cancel this pending token?")`. | Native confirm only; no modal, no "reason for cancel" or audit note. |
| **Vial selection UX** | Manual vial session ID. | No dropdown of active vials for variant; no remaining ml check before submit. |
| **Token generation UX** | Raw visitId/variantId/dose inputs. | No visit/patient/variant search or autocomplete; no link from prescription/order. |
| **Consistency with WowDash** | Bootstrap-style cards and tables. | No shared clinic card/table/stepper components; patterns should align with existing enterprise clinic pages. |

---

## D. DATA CONTRACT REVIEW

Base URL: `/api/v1/clinic/branches/:branchId` (frontend `clinicBase(branchId)`). All below under `medicine-control/` unless noted.

| API | Route | Method | Request shape | Response shape | Status | Mismatch risk |
|-----|--------|--------|----------------|-----------------|--------|----------------|
| **List tokens** | `medicine-control/injection-tokens` | GET | Query: `status`, `visitId`, `patientId`, `tokenCode`, `fromDate`, `toDate`, `take`, `skip` | `data: { list: Token[], total: number }` | OK | Low. Frontend uses status, tokenCode, take=100; backend supports more. |
| **Generate token** | `medicine-control/injection-token` | POST | Body: visitId, variantId, expectedDose, unit?, medicineSource?, expiresInHours?, prescriptionId?, orderId?, patientId?, petId?, treatmentCourseId?, treatmentDayId?, selectedVialSessionId? | `data: Token` (created with includes) | OK | Low. Controller does not pass treatmentCourseId/treatmentDayId/selectedVialSessionId; frontend doesn't send them. |
| **Validate token** | `medicine-control/injection-token/validate` | GET | Query: `tokenCode` | On success: `data: { valid: true, token: Token }`; on failure 400 with message | OK | None. Frontend uses `result.token`. |
| **Token context** | `medicine-control/injection-token/:id/context` | GET | Params: id | `data: Token` with treatmentCourse, treatmentDay, selectedVialSession, patient, pet, variant, visit | OK | None. Frontend expects tokenContext.treatmentCourse, .treatmentDay, .selectedVialSession. |
| **Cancel token** | `medicine-control/injection-token/:id/cancel` | PATCH | — | `data: Token` (updated) | OK | None. |
| **Record dose** | `medicine-control/dose` | POST | Body: patientId, variantId, administeredDose, visitId?, surgeryCaseId?, vialSessionId?, injectionTokenId?, medicineSource?, prescribedDose?, unit?, route?, witnessedByUserId?, emergencyBypass? | `data: MedicationAdministration` (with variant, vialSession, injectionToken) | OK | Low. Frontend sends all used fields; backend allows surgeryCaseId, witnessedByUserId. |
| **Dose by visit** | `medicine-control/dose/visit/:visitId` | GET | Params: visitId | `data: { list: MedicationAdministration[] }` | Backend only | Not used by these two pages. |
| **Vial sessions list** | `medicine-control/vial-sessions` | GET | Query: `status?` | `data` = array or list/items (frontend normalizes to array) | OK | Low. Active-vials and injection-room could share; injection-room does not currently call it for vial dropdown. |
| **Branch dashboard** | `medicine-control/dashboard/branch` | GET | — | `data: { issuedToday, unresolvedReturns, activeSessions, pendingApprovals, injectionMonitor: { tokensGenerated, tokensUsed, injectionsToday }, reconciliation: { … } }` | OK | Dashboard page uses it; injection-tokens/injection-room do not. |

**Notes:**

- All success responses are `{ success: true, data }`. Frontend uses `res?.data` (api.ts returns `res?.data`).
- Error responses use `sendClinicError` (statusCode, message, code, meta). Frontend shows `(e as Error)?.message` in toast; no structured code handling.

---

## E. IMPLEMENTATION PLAN (Phased)

### Phase 2: Backend fixes (no breaking changes)

1. **Contract hardening**
   - Document and optionally add DTOs/validators for generate token and record dose (request body validation, type exports).
   - Ensure list tokens always returns `{ list, total }` and context returns a single token object (already true).
2. **Optional backend additions**
   - If needed for UX: endpoint to list "active vial sessions for variant" (or reuse vial-sessions with variantId filter) for injection-room vial dropdown.
   - Consider returning `expiresAt` and `tokenValiditySameDayOnly` hint in validate/context so frontend can show "Valid until …".
3. **Controller**
   - Optionally pass `treatmentCourseId`, `treatmentDayId`, `selectedVialSessionId` from body to `injectionTokenService.generateToken` when provided (for future UI).

### Phase 3: Frontend upgrade

1. **Shared structure**
   - Reuse existing clinic layout; add optional `medicine-control` layout only if needed for shared state/tabs.
   - Introduce shared clinic types (e.g. `InjectionToken`, `TokenContext`, `RecordDosePayload`) in a types file or api contract module used by both pages.
2. **Injection-tokens page**
   - Add small dashboard strip (e.g. pending count, used today) using list or a lightweight stats API.
   - Add date range filters and pagination (or "Load more") for list.
   - Replace raw IDs with search/autocomplete where feasible (visit, variant) per BPA patterns.
   - Token table: add optional "View details" opening context/audit; replace native confirm with modal for cancel (optional reason).
   - Empty/loading/error: use shared clinic components and clear CTAs.
3. **Injection-room page**
   - Stepper: clear Step 1 → Step 2 with completion state; "Clear" / "Next patient" resets form and token.
   - Patient/prescription summary card after validate (use context: patient, pet, visit, variant, treatment course/day).
   - Active vial panel: show selectedVialSession (remainingQty, validUntil); if no selection, offer dropdown of active vials for variant (call vial-sessions or new endpoint).
   - Dose form: keep emergency bypass; add validation (e.g. administered ≤ remaining ml when vial selected).
   - Optional: "Dose history" drawer for visit (call dose/visit/:visitId).
4. **API layer**
   - Keep existing `lib/api.ts` methods; add typed response interfaces where helpful. Ensure error handling can show backend message/code if needed.

### Phase 4: QA / edge case validation

- Token: generate with same-day policy vs 24h; validate expired/used/cancelled; cancel already-used (must fail).
- Dose: with token, without token (bypass), wrong patient/variant/visit; OUTSIDE without receive; vial session insufficient remaining; partial dose.
- Permissions: all actions with and without required permissions.
- Concurrency: double-record same token (second must fail); list/context consistency.

---

## Deliverables Summary

### 1. Exact files to modify

| File | Changes (summary) |
|------|-------------------|
| `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/medicine-control/injection-tokens/page.tsx` | Add stats strip, date filters, pagination, cancel modal, better empty/error states, optional token detail/audit. |
| `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/medicine-control/injection-room/page.tsx` | Stepper UX, patient/prescription card, active vial panel + optional vial dropdown, dose validation, optional dose history drawer. |
| `bpa_web/lib/api.ts` | Add types for token/context/dose responses if desired; no breaking change to existing function signatures. |
| `backend-api/src/api/v1/modules/clinic/clinic.controller.ts` | Optional: pass treatmentCourseId, treatmentDayId, selectedVialSessionId to generateToken. |
| `backend-api/src/api/v1/modules/clinic/injectionToken.service.ts` | No change required for current behavior; optional: expose expiresAt/sameDay hint in validate response. |

### 2. New files to create (if needed)

| File | Purpose |
|------|---------|
| `bpa_web/src/types/clinicMedicineControl.ts` (or under existing types) | Shared types: InjectionToken, TokenContext, RecordDosePayload, VialSessionSummary. |
| `bpa_web/src/components/clinic/` (or under staff clinic) | Reusable: TokenSummaryCard, VialSessionPanel, DoseForm, Stepper, ConfirmModal — only if not duplicating existing WowDash/clinic components. |
| Optional: `backend-api` DTO/validator files for injection token and dose | Request validation and shared types. |

### 3. Risk list

| Risk | Mitigation |
|------|------------|
| Changing response shapes | Phase 2 keeps responses backward compatible; frontend continues to use `res?.data`. |
| Duplicated business logic in UI | Keep validation and rules on backend; frontend only for UX and display. |
| Permission drift | Use same permission keys as backend; gate all new actions. |
| Vial dropdown requires variant filter | Backend may need `vial-sessions?variantId=` or equivalent; confirm with existing listVialSessions. |
| Override approval vs emergency bypass | Keep clearly separated in docs and UI; do not mix "record without token" with "approve exception (e.g. expired vial)". |

### 4. Recommended implementation sequence

1. **Phase 2 (backend):** Document contracts; optional DTOs; optional treatmentCourseId/treatmentDayId/selectedVialSessionId in generate; optional "vial sessions by variant" or filter.
2. **Phase 3 (frontend):** Types and API typings → injection-tokens page (stats, filters, pagination, cancel modal) → injection-room page (stepper, summary card, vial panel, validation) → shared components only where they reduce duplication.
3. **Phase 4:** QA checklist and edge-case tests as above.

---

**End of audit.** No code has been changed; this document is analysis and planning only.
