# BPA Clinic Treatment Workflow — Enforcement Rules

**Date:** 2026-03-14  
**Scope:** Backend-only validation added to ensure operational safety. No architecture redesign.

---

## 1. Enforcement Rules Summary

| # | Transition / Rule | Status | Where Enforced |
|---|--------------------|--------|----------------|
| 1 | **Billing Completed → Token Generated** | **Verified (existing)** | `injectionToken.service.ts` — `generateToken()` requires a paid order (orderId or latest COMPLETED order for visit); throws if no order or `paymentStatus !== "COMPLETED"`. |
| 2 | **Dispense Issued → Injection Room Receive** | **Added** | Vial usage (open vial or record dose from a session tied to a dispense request) is blocked until that dispense request has been received: `openVial.service.ts`, `doseConsumption.service.ts`, `dispenseControl.service.ts` (helper). |
| 3 | **Token Validated → Dose Administered** | **Verified (existing)** | `doseConsumption.service.ts` — `recordAdministration()` requires `injectionTokenId` (or emergency bypass); `getUsableTokenById()` validates token status and expiry. |
| 4 | **Vial Selected → Dose Administered** | **Strengthened** | INTERNAL medicine now **requires** `vialSessionId` so dose is always tied to mL consumption; room mismatch already enforced when token has selected vial. |
| 5 | **Dose Administered → mL Consumption Posted** | **Verified (existing)** | When `vialSessionId` is provided, `openVialService.recordDose()` is called inside `recordAdministration()`, so consumption is posted. New rule ensures INTERNAL cannot bypass vial (see #4). |
| 6 | **EOD Reconciliation → Incident if mismatch** | **Existing (unchanged)** | Reconciliation and incident raising logic unchanged; not part of this pass. |
| 7 | **EOD Close → Block if unresolved blockers** | **Verified (existing)** | `eodHandover.getEodStatus()` computes blockers (pending tokens, active vials, reconciliation not run, unacknowledged mismatch); `eodClose` in controller returns 400 if `!status.canClose`. |

---

## 2. Rules Added (New Validation)

1. **Injection token cannot be generated without a completed paid order**  
   - **Status:** Already enforced. No code change.  
   - **Location:** `injectionToken.service.ts` — lines 79–99: order lookup by `orderId` or latest COMPLETED for visit; throw if no order or `paymentStatus !== "COMPLETED"`.

2. **Dose cannot be administered without valid token, valid vial session, correct injection room**  
   - **Token:** Already required (or emergency bypass).  
   - **Vial session (INTERNAL):** **Added** — For `medicineSource === "INTERNAL"`, `vialSessionId` is now required; otherwise throw: `"Vial session is required for internal medicine dose administration"`.  
   - **Room:** Already enforced — when token has `selectedVialSessionId`, room of the vial used must match token’s selected vial room (`ROOM_MISMATCH`).  
   - **Location:** `doseConsumption.service.ts`.

3. **Dispense requests must be RECEIVED before vial usage**  
   - **Added** — If a vial session was activated from a dispense request (`activatedFromDispenseRequestId`), that dispense request must have been received (`receivedAt` set; status ISSUED or PARTIALLY_ISSUED). Enforced at:  
     - **Open vial:** Before creating a new `VialSession` with `activatedFromDispenseRequestId`, require the dispense request to be received.  
     - **Record dose (vial session):** Before decrementing a vial session that has `activatedFromDispenseRequestId`, require the dispense request to be received.  
   - **Location:** `openVial.service.ts` (openVial, recordDose), `doseConsumption.service.ts` (recordAdministration), `dispenseControl.service.ts` (new helper).

4. **EOD close checks: pending tokens, open vials, unresolved reconciliation mismatches**  
   - **Status:** Already enforced. No code change.  
   - **Location:** `eodHandover.service.ts` — `getEodStatus()`; `clinic.controller.ts` — `eodClose` returns 400 with blocker messages if `!status.canClose`.

---

## 3. Files Modified

| File | Changes |
|------|--------|
| `src/api/v1/modules/clinic/dispenseControl.service.ts` | Added `requireDispenseRequestReceived(requestId, branchId)` — throws if dispense request not found, not ISSUED/PARTIALLY_ISSUED, or `receivedAt` is null. |
| `src/api/v1/modules/clinic/openVial.service.ts` | Import `dispenseControl`. In `openVial()`: before transaction, if `activatedFromDispenseRequestId` is set, call `requireDispenseRequestReceived`. In `recordDose()`: after loading session, if `activatedFromDispenseRequestId` is set, call `requireDispenseRequestReceived`. |
| `src/api/v1/modules/clinic/doseConsumption.service.ts` | Import `dispenseControl`. After resolving source: if `resolvedSource === "INTERNAL"` and no `vialSessionId`, throw. When `vialSessionId` is set: load session with `activatedFromDispenseRequestId`; if set, call `requireDispenseRequestReceived`. Room mismatch block refactored to always load vial session when `vialSessionId` is provided so dispense check can run. |

**Controllers / middleware:** No changes. All new logic is in services.

---

## 4. New Validation Logic (Code-Level)

### 4.1 `requireDispenseRequestReceived(requestId, branchId)` — dispenseControl.service.ts

- Fetches `DispenseRequest` by id and branchId.
- Throws if not found.
- Throws if `status` is not `ISSUED` or `PARTIALLY_ISSUED`.
- Throws if `receivedAt` is null: *"Dispense request must be received by injection room before opening or using this vial"*.

### 4.2 openVial.service.ts

- **openVial:** At start, if `params.activatedFromDispenseRequestId != null`, call `requireDispenseRequestReceived(activatedFromDispenseRequestId, branchId)`. This blocks opening a vial from an unreceived dispense.
- **recordDose:** After loading the vial session, if `session.activatedFromDispenseRequestId != null`, call `requireDispenseRequestReceived(session.activatedFromDispenseRequestId, session.branchId)`. This blocks direct mL recording (e.g. standalone recordDose API) for vials from unreceived dispense.

### 4.3 doseConsumption.service.ts

- **INTERNAL requires vial session:** After resolving `resolvedSource`, if `resolvedSource === "INTERNAL"` and `data.vialSessionId` is null or empty string, throw: *"Vial session is required for internal medicine dose administration"*.
- **Dispense received before dose:** When `data.vialSessionId != null`, load vial session with `roomId`, `activatedFromDispenseRequestId`, `branchId`. If `activatedFromDispenseRequestId != null`, call `requireDispenseRequestReceived(activatedFromDispenseRequestId, data.branchId)` before proceeding with dose and vial decrement.

---

## 5. QA Test Scenarios

### 5.1 Token generation (existing — regression)

- **Scenario:** Generate injection token without a completed paid order (no orderId, and no COMPLETED order for visit).  
- **Expected:** 400 / error: *"Paid order is required before generating injection token"* or *"Order payment is not completed"*.
- **Scenario:** Generate token with valid orderId and paymentStatus COMPLETED.  
- **Expected:** 200, token created.

### 5.2 Dispense receive before vial use (new)

- **Scenario:** Create and issue a dispense request; do **not** call receive. Open a new vial with `activatedFromDispenseRequestId` set to that request.  
- **Expected:** Error: *"Dispense request must be received by injection room before opening or using this vial"* (or equivalent from `requireDispenseRequestReceived`).
- **Scenario:** Same dispense request; call receive (POST dispense-request/:id/receive). Then open vial with same `activatedFromDispenseRequestId`.  
- **Expected:** 200, vial session created.
- **Scenario:** Vial session already exists and is tied to a dispense request that has **not** been received. Call record dose (recordAdministration with that vialSessionId) or standalone recordDose for that session.  
- **Expected:** Error that dispense must be received before using this vial.
- **Scenario:** Receive the dispense request, then record dose with that vial session.  
- **Expected:** 200, dose recorded and vial decremented.

### 5.3 Dose administration: token, vial session, room (new / existing)

- **Scenario:** Record dose with INTERNAL source (or token with INTERNAL) but **no** vialSessionId.  
- **Expected:** Error: *"Vial session is required for internal medicine dose administration"*.
- **Scenario:** Record dose with valid token, valid vialSessionId, same branch; token has no selectedVialSession.  
- **Expected:** 200 (room check N/A).
- **Scenario:** Token has selectedVialSession in room A; call recordAdministration with vialSessionId for a session in room B.  
- **Expected:** Error: `ROOM_MISMATCH`.
- **Scenario:** Record dose without injectionTokenId and without emergency bypass.  
- **Expected:** Error: *"injectionTokenId is required"*.

### 5.4 EOD close (existing — regression)

- **Scenario:** Call eodClose when there are pending (PENDING, non-expired) tokens for that day.  
- **Expected:** 400, message indicating pending tokens, `canClose: false`.
- **Scenario:** Call eodClose when there are active vial sessions opened that day.  
- **Expected:** 400, message indicating active vial sessions.
- **Scenario:** Call eodClose when daily reconciliation has not been run.  
- **Expected:** 400, blocker: daily reconciliation not run.
- **Scenario:** Call eodClose when reconciliation has run but has unacknowledged mismatch.  
- **Expected:** 400, blocker: reconciliation has unacknowledged mismatch.
- **Scenario:** Call eodClose when no blockers (no pending tokens, no active vials, reconciliation run and acknowledged or no mismatch).  
- **Expected:** 200, `{ closed: true, date: "..." }`.

---

## 6. References

- Flow and gaps: `docs/CLINIC_E2E_FLOW_IMPLEMENTATION_AUDIT.md`
- Remediation plan: `docs/CLINIC_E2E_REMEDIATION_PLAN.md`
- Data/API spec: `docs/CLINIC_PHARMACY_DATA_AND_API_SPEC.md`
