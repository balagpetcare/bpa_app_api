# BPA Clinic Injection Tokens + Injection Room — Final Stabilization Audit

**Date:** 2026-03-14.
**Scope:** injection-tokens, injection-room, token validation, dose recording, room mismatch, bypass, board filters.
**Classification:** blocker / non-blocking gap / polish / no issue.

**See also:** [CLINIC_INJECTION_TOKEN_AUDIT.md](./CLINIC_INJECTION_TOKEN_AUDIT.md) — enterprise internal vs external patient / billing / gap analysis (codebase-first, 2026-03-23).

---

## Phase A — Full code audit

### 1. Injection-tokens flow

| Check | Finding | Classification |
|-------|---------|----------------|
| List load, filters, pagination | List API called with status, tokenCode, validatedByMe, generatedByMe, fromDate, toDate, skip, take. Response list/total normalized. Page reset on filter change. | No issue |
| Generate token (visit search, Rx/course/day/vial) | Visit search → prescriptions/courses/vial sessions loaded; generate sends prescriptionId, treatmentCourseId, treatmentDayId, selectedVialSessionId. Backend accepts and persists. | No issue |
| Token drawer / context | openDetail sets detailToken(row), fetches context; on context failure detailContext stays null. Drawer uses detailContext for audit; list row has generatedBy/validatedBy. Fallback to User #id when context null is acceptable; could prefer list row displayName when context missing. | Polish |
| Cancel with/without reason | Modal with reason textarea; body.reason sent; backend persists cancelReason. Confirmation text: "Cancel token …? This cannot be undone." | No issue |
| "Open visit" link | Uses `detailToken.visitId` in href. If visitId is null, link becomes `/visits/undefined`. | Non-blocking gap |
| Unused import | humanizeEnum imported but not used (StatusBadge used for status). | Polish |

### 2. Injection-room flow

| Check | Finding | Classification |
|-------|---------|----------------|
| Validate / re-validate | Validate returns { valid, token?, reason?, alreadyValidated? }. Frontend sets tokenPayload, fetches context, shows toast for alreadyValidated. Re-validation does not re-write DB. | No issue |
| Steps 2–4, vial list, room mismatch | Step 3 shows room mismatch when selected vial room ≠ token vial room. Step 4 shows expected dose and dose-differs warning. Submit catches ROOM_MISMATCH and shows friendly message. | No issue |
| Record dose (normal) | patientId, visitId, variantId, vialSessionId, injectionTokenId, prescribedDose, administeredDose, unit, route, medicineSource. Backend sets administeredByUserId from req.user. | No issue |
| Bypass modal | Reason required; emergencyBypassReason sent. loadBoard() after submit. | No issue |
| Board tabs and filters | pendingTokens, unassignedTokens, completedToday, bypassToday, expiredOrProblemToday. roomId, validatedByMe, administeredByMe. expiredOrProblemToday accessed without ?? [] — if API ever returns undefined, could throw. | Polish |

### 3. Token validation (backend + frontend)

| Check | Finding | Classification |
|-------|---------|----------------|
| Validate API | Controller returns sendClinicSuccess(res, 200, result). result = { valid, token?, alreadyValidated? }. On invalid, 400 with reason. | No issue |
| Frontend use | staffClinicValidateInjectionToken returns res?.data. On 400, apiGet throws parseError; catch shows message. | No issue |

### 4. Dose recording (backend + frontend)

| Check | Finding | Classification |
|-------|---------|----------------|
| recordDose | Controller maps body to recordAdministration; administeredByUserId = req.user?.id ?? body. | No issue |
| Room mismatch | doseConsumption checks token selectedVialSession.roomId vs vialSession.roomId; throws ROOM_MISMATCH. Controller catch returns 400 with message. | No issue |

### 5. Room mismatch

| Check | Finding | Classification |
|-------|---------|----------------|
| Backend | Enforced in recordAdministration when token has selectedVialSession and request has vialSessionId. | No issue |
| Frontend | Step 3 warning; submit error message. | No issue |

### 6. Bypass / approval linkage

| Check | Finding | Classification |
|-------|---------|----------------|
| Bypass | Emergency bypass (no token); reason persisted. No linkage to exception override/approval flow. | No issue |

### 7. Board filters and reporting

| Check | Finding | Classification |
|-------|---------|----------------|
| Filters | roomId, validatedByMe, administeredByMe passed; backend filters pending/unassigned and completed/bypass. | No issue |
| Tabs | All five tabs render; pending/unassigned/completed use ?? [] for safety; expired uses board.expiredOrProblemToday directly. | Polish (expired) |

---

## Blocker summary

**No blocker identified.** All flows are consistent; no workflow-breaking gap.

---

## Non-blocking gaps

1. **Open visit link:** When `detailToken.visitId` is null, link href is `/visits/undefined`. Fix: render link only when `detailToken.visitId` is present.

---

## Polish (safe to fix)

1. Remove unused `humanizeEnum` import (injection-tokens).
2. Use `(board.expiredOrProblemToday ?? [])` in injection-room expired tab for defensive null/undefined.
3. Token drawer audit: prefer `(detailContext ?? detailToken)` for generatedBy/validatedBy display so list row data is used when context fetch fails (displayName instead of "User #id" when available from list).

---

## No issue (no change)

- List/board API response shapes and null handling elsewhere.
- Validate/record/cancel/board backend and frontend contract.
- Pagination + filters interaction.
- Permissions and AccessDenied.
- Cancel and bypass confirmation messaging.
