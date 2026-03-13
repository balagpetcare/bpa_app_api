# Clinic Injection Tokens & Injection Room — Phase 4 Gap Analysis

**Focus:** Operator accountability, room execution completion, source-of-truth consistency.  
**Date:** 2026-03-14.  
**Scope:** Backend + frontend for injection-tokens and injection-room (Phase 3 complete).

---

## 1. OPERATOR ACCOUNTABILITY GAP

| Capability | Status | Notes |
|------------|--------|--------|
| Validated by me | **Missing** | validatedByUserId/validatedAt stored; no list/board filter by current user. |
| Administered by me | **Partial** | administeredByUserId stored on MedicationAdministration; not exposed in board filters or list. |
| My pending tokens | **Missing** | No "pending for me" (e.g. validated by me, not yet used) filter. |
| My completed injections today | **Missing** | completedToday on board has no administeredBy in response; no filter by operator. |
| Operator history / accountability | **Partial** | Token drawer shows validated by; list/board do not include operator fields or filters. |
| Operator-specific filters on board and token list | **Missing** | List tokens: no validatedByUserId, generatedByUserId; board: no operator filter. |

**Conclusion:** Add validatedByUserId, generatedByUserId to list options (with "me" resolved server-side); add optional operator filter to board; include validatedBy/generatedBy in list response and administeredBy in completedToday.

---

## 2. ROOM EXECUTION COMPLETION GAP

| Capability | Status | Notes |
|------------|--------|--------|
| Unassigned tokens when no selected vial exists | **Partial** | Tokens without selectedVialSessionId exist; when roomId filter is applied they are excluded (pendingWhere requires selectedVialSession.roomId). |
| No-room / unassigned bucket | **Missing** | Board does not return a separate unassigned list; UI cannot show "tokens without room" when filtering by room. |
| Explicit room assignment vs vial-derived room | **Partial** | Room is vial-derived only (VialSession.roomId); no explicit roomId on InjectionToken. |
| Room mismatch warning during injection | **Missing** | No check that selected vial session’s room matches token’s pre-selected vial room. |
| Room-aware queue completeness | **Partial** | Room filter shows only tokens with vial in that room; unassigned tokens are hidden. |

**Conclusion:** Return unassignedTokens from board (pending with no selectedVialSession); when roomId set, pendingTokens = in-room, unassignedTokens = no vial. Add room mismatch validation in recordDose (token.selectedVialSession.roomId vs request vialSession.roomId).

---

## 3. SOURCE-OF-TRUTH CONSISTENCY GAP

| Element | Status | Notes |
|---------|--------|--------|
| Prescription line → variant/dose | **Implemented** | Phase 3: prescription line selector sets variant/dose; submit sends prescriptionId. |
| Selected variant ↔ expected dose | **Partial** | Form can change variant/dose; no lock or strong warning when diverging from token. |
| Expected dose ↔ administered dose | **Partial** | Prefilled from token; user can change; no validation or warning. |
| Selected vial session ↔ room derived from vial | **Partial** | Token can have selectedVialSessionId; context returns selectedVialSession (no room in context currently); room from vial not validated at record. |
| Submit payload vs visible UI | **OK** | Same variant/dose/vial sent as displayed; risk is user changing vial to different room. |

**Conclusion:** Include room in token context selectedVialSession; add room mismatch check on record; optionally lock or warn on dose/variant divergence from token in UI.

---

## 4. DATA MODEL / API REVIEW

| Question | Recommendation |
|----------|-----------------|
| administeredByUserId in board filters? | **Add now.** Already stored; include in completedToday response; add optional validatedByUserId filter to board for "validated by me" pending. |
| Operator filter params for board/list? | **Add now.** List: validatedByUserId, generatedByUserId (backend resolves "me" from req.user.id via query validatedByMe=true, generatedByMe=true). Board: optional validatedByUserId for pending. |
| Explicit roomId on token vs vial-derived? | **Later.** Keep room vial-derived; no schema change. Add unassigned bucket and room mismatch validation only. |

**No new migration** for Phase 4 (all required fields exist).

---

## 5. IMPLEMENTATION PLAN (Phase 4)

**A. Backend/API**  
1. List tokens: add query validatedByMe, generatedByMe (resolve to req.user.id); add validatedByUserId, generatedByUserId to ListTokenOptions; list response include validatedBy, generatedBy.  
2. Board: return unassignedTokens (pending with selectedVialSessionId null); when roomId set, pendingTokens = in-room only, unassignedTokens = no-vial; completedToday include administeredBy.  
3. recordDose: when token has selectedVialSessionId and request has vialSessionId, if token’s selectedVialSession.roomId != vialSession.roomId, reject with ROOM_MISMATCH (or allow with explicit override in later phase).  
4. Token context: include selectedVialSession.room (id, name, code) for room mismatch UX.

**B. Prisma/migration**  
None.

**C. Frontend**  
1. API: list params validatedByMe, generatedByMe; board response unassignedTokens; board params validatedByMe optional.  
2. Injection-tokens: operator filter (All / Validated by me / Generated by me); pass validatedByMe/generatedByMe to list.  
3. Injection-room: Unassigned (no room) tab/section; room mismatch warning when selected vial room != token pre-selected vial room; consistency: show expected dose from token, warn if administered differs.

**D. QA**  
- List: validated by me / generated by me; board: unassigned tab; record dose: room mismatch rejected; token context has room; operator shown in completed today.

---

## Files to Modify (Phase 4)

| File | Changes |
|------|--------|
| `backend-api/src/api/v1/modules/clinic/injectionToken.service.ts` | ListTokenOptions: validatedByUserId?, generatedByUserId?; listTokens where + include validatedBy, generatedBy. |
| `backend-api/src/api/v1/modules/clinic/auditIntelligence.service.ts` | getInjectionRoomBoard: unassignedTokens; when roomId set split pending/in-room vs unassigned; completedToday include administeredBy. |
| `backend-api/src/api/v1/modules/clinic/doseConsumption.service.ts` | recordAdministration: load token with selectedVialSession.roomId and vialSession.roomId; reject if both set and different (ROOM_MISMATCH). |
| `backend-api/src/api/v1/modules/clinic/injectionToken.service.ts` | getTokenWithTreatmentContext: selectedVialSession include room (id, name, code). |
| `backend-api/src/api/v1/modules/clinic/clinic.controller.ts` | listInjectionTokens: pass validatedByMe/generatedByMe → req.user.id; getInjectionRoomBoard: optional validatedByUserId. |
| `bpa_web/lib/api.ts` | staffClinicInjectionTokensList: validatedByMe?, generatedByMe?; staffClinicInjectionRoomBoard: unassignedTokens in return type, validatedByMe?. |
| `bpa_web/src/types/clinicMedicineControl.ts` | InjectionRoomBoard add unassignedTokens; VialSessionSummary add room?. |
| `bpa_web/.../injection-tokens/page.tsx` | Operator filter dropdown; pass validatedByMe/generatedByMe to list. |
| `bpa_web/.../injection-room/page.tsx` | Unassigned tab/section; room mismatch warning; administeredBy in completed list; consistency warning for dose. |

## New Files

None.

## Migrations

None.

## Risk List

| Risk | Mitigation |
|------|------------|
| Room mismatch too strict | Reject only when token has pre-selected vial with room and user selects a different vial with different room; no room on token/vial → allow. |
| "Me" when unauthenticated | Backend only applies validatedByMe/generatedByMe when req.user?.id exists; otherwise filter ignored. |
| Unassigned count when no room filter | When roomId not set, unassignedTokens = pending tokens with no selectedVialSession; pendingTokens = all pending (existing behaviour). |

## Recommended Implementation Sequence

1. Backend: injectionToken list options + includes; controller list params.  
2. Backend: getInjectionRoomBoard unassignedTokens + completedToday administeredBy.  
3. Backend: doseConsumption room mismatch check; token context room in selectedVialSession.  
4. Frontend: API + types.  
5. Frontend: injection-tokens operator filter.  
6. Frontend: injection-room unassigned bucket, room mismatch warning, consistency (dose) warning.
