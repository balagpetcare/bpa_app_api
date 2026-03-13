# Clinic Injection Tokens & Injection Room — Phase 3 Implementation

**Focus:** Clinical execution hardening (validation persistence, treatment-aware token generation, room/operator support).

---

## Changed files

### Backend (backend-api)

| File | Changes |
|------|--------|
| `prisma/schema.prisma` | InjectionToken: added `validatedByUserId Int?`, `validatedAt DateTime?`; relation `validatedBy` to User; User relation `injectionTokensValidated`. |
| `src/api/v1/modules/clinic/clinic.audit.ts` | Added CLINIC_AUDIT_ACTIONS.INJECTION_TOKEN_VALIDATED. |
| `src/api/v1/modules/clinic/injectionToken.service.ts` | validateToken: accepts optional `validatedByUserId`; on first successful validation updates token with validatedByUserId, validatedAt; returns `alreadyValidated` when token was already validated; include validatedBy in token. getTokenWithTreatmentContext: include validatedBy. |
| `src/api/v1/modules/clinic/clinic.controller.ts` | validateInjectionToken: pass userId to validateToken; after success and !alreadyValidated call writeClinicAudit INJECTION_TOKEN_VALIDATED. getInjectionRoomBoard: read query.roomId, pass to getInjectionRoomBoard. |
| `src/api/v1/modules/clinic/auditIntelligence.service.ts` | getInjectionRoomBoard: added optional `roomId`; when set, filter pendingTokens by selectedVialSession.roomId; include selectedVialSession with room (id, roomId, room.name/code) in pendingTokens select. |

### Frontend (bpa_web)

| File | Changes |
|------|--------|
| `src/types/clinicMedicineControl.ts` | InjectionToken: validatedByUserId, validatedAt, validatedBy. ValidateTokenResult: alreadyValidated. |
| `lib/api.ts` | staffClinicInjectionRoomBoard(branchId, params?: { date?, roomId? }). |
| `app/.../injection-tokens/page.tsx` | Token drawer: show "Validated by X at Y" in audit block. Treatment-aware form: when visit selected load prescriptions and treatment courses; optional prescription dropdown + prescription line selector (sets variant/dose from item); optional treatment course and treatment day dropdowns; optional vial session dropdown when variant set; visit context preview shows "X Rx, Y course(s)"; handleGenerate sends prescriptionId, treatmentCourseId, treatmentDayId, selectedVialSessionId. |
| `app/.../injection-room/page.tsx` | Validate: show toast "Token was already validated — ready to inject" when alreadyValidated; show info alert "Already validated by X at Y. You can proceed to inject." when token has validatedAt. Board: load rooms (staffClinicRoomsList); room filter dropdown; loadBoard passes roomId; pending tokens display room badge when selectedVialSession.room present. |

---

## New files

| File | Purpose |
|------|--------|
| `prisma/migrations/20260323120000_injection_validation_phase3/migration.sql` | Adds injection_tokens.validatedByUserId, validatedAt and FK to users. |

---

## Migrations created

- **20260323120000_injection_validation_phase3**: Adds validatedByUserId, validatedAt to injection_tokens and FK to users. Run: `npx prisma migrate deploy` (or `prisma migrate dev`).

---

## Summary of completed work

### A. Validation persistence
- **DB:** validatedByUserId, validatedAt on InjectionToken; validatedBy relation to User.
- **Service:** validateToken(tokenCode, branchId, validatedByUserId?) — on first valid validation writes validatedByUserId, validatedAt; returns token and alreadyValidated when already validated.
- **Audit:** INJECTION_TOKEN_VALIDATED written only on first validation (when !alreadyValidated).
- **Token drawer:** Audit section shows "Validated by … at …" when validatedAt is set.
- **Re-validation:** Re-validate returns valid: true, alreadyValidated: true; UI shows "Token was already validated — ready to inject" and info alert with validated by/at; user can still proceed to inject (no invalid flow).

### B. Treatment-aware token generation
- **Prescription:** When visit selected, prescriptions by visit loaded; optional Prescription dropdown; when prescription selected, optional "Line" dropdown (items with productVariantId) to set variant and dose from line.
- **Treatment course / day:** When visit has patientId, treatment courses list loaded; optional Course dropdown; when course selected, schedule loaded and optional Day dropdown.
- **Vial session:** When variant selected, active vial sessions for variant loaded; optional Vial session dropdown to set selectedVialSessionId.
- **Visit context:** Preview line shows "X Rx, Y course(s)" when data loaded.
- **Form:** Optional row (Rx, course, day, vial) only when visit selected; dense layout preserved.

### C. Room/operator support
- **Board API:** GET injection-room/board accepts optional roomId; pending tokens filtered by selectedVialSession.roomId when roomId provided (tokens with a selected vial in that room).
- **Board response:** pendingTokens include selectedVialSession with room (id, name, code).
- **Frontend:** Rooms list loaded; "All rooms" / room dropdown on operations board; refetch board with roomId when room selected; pending list shows room badge per token when selectedVialSession.room exists.
- **Branch-level:** When roomId not sent, board unchanged (all pending tokens); no breaking change.

---

## Remaining known gaps

- **Operator identity:** Board does not filter by “validated by me” or “generated by me”; could add operator filter in a later phase.
- **Token generation:** Prescription line selector only applies when prescription has items with productVariantId; variant from line may not appear in main Medicine dropdown if not in policies (submit still uses variantId).
- **Room on token:** Token has no direct roomId; room is derived from selectedVialSession only; tokens without selected vial are excluded when room filter is applied.

---

## Test checklist

- [ ] **Migration:** Run Phase 3 migration; confirm validatedByUserId, validatedAt columns and FK.
- [ ] **Validate first time:** Validate a PENDING token; confirm validatedByUserId, validatedAt set and INJECTION_TOKEN_VALIDATED audit entry.
- [ ] **Validate again:** Re-validate same token; confirm alreadyValidated in response, no second audit, no DB change; UI shows “already validated” message and allows proceeding.
- [ ] **Token drawer:** Open detail for a validated token; confirm “Validated by … at …” in audit block.
- [ ] **Generate with prescription:** Select visit, select prescription, optionally select line; generate; confirm prescriptionId (and variant/dose from line if used) on token.
- [ ] **Generate with course/day:** Select visit, course, day; generate; confirm treatmentCourseId, treatmentDayId on token.
- [ ] **Generate with vial:** Select visit and variant, select vial session; generate; confirm selectedVialSessionId on token.
- [ ] **Board room filter:** Select a room; confirm pending list only shows tokens whose selected vial is in that room; “All rooms” shows all pending.
- [ ] **Board room badge:** Confirm pending tokens with selectedVialSession show room name badge.
- [ ] **Injection room:** After validating (first or re-validate), confirm step 2 and dose flow work; when already validated, confirm info message and toast.
