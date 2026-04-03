# Clinic execution chain QA — Queue → Visit → Billing → Settlement

**Date:** 2026-03-21  
**Method:** Static code trace against canonical docs (no live browser/DB run in this pass).  
**Related docs:**  
[bpa_web: CLINIC_VISITS_ENTERPRISE_MODULE_PLAN.md](../../bpa_web/docs/CLINIC_VISITS_ENTERPRISE_MODULE_PLAN.md) · [CLINIC_VISITS_PRODUCTION_HARDENING_PASS.md](../../bpa_web/docs/CLINIC_VISITS_PRODUCTION_HARDENING_PASS.md) · [CLINIC_VISITS_RELEASE_READINESS.md](../../bpa_web/docs/CLINIC_VISITS_RELEASE_READINESS.md) · [DOCTOR_VISIT_COMPLETION_GOVERNANCE.md](./DOCTOR_VISIT_COMPLETION_GOVERNANCE.md) · [CLINIC_E2E_FLOW_IMPLEMENTATION_AUDIT.md](./CLINIC_E2E_FLOW_IMPLEMENTATION_AUDIT.md)

---

## 1. End-to-end issues found

| # | Area | Issue | Severity |
|---|------|--------|----------|
| E1 | Queue → Visit | `queue.service.completeService` completed visits with a **raw** `prisma.visit.update` + separate `createSettlementLedgerForVisit`, **bypassing** `emr.completeVisitWithPolicy` and `emr.updateVisit`. Effects: no branch completion policy, no `DoctorAuditLog` for that path, **no** `setRoomCleaningForVisit`, duplicate settlement invocation pattern, and risk of **resetting `completedAt`** if the ticket was completed again while the visit was already `COMPLETED`. | **High** |
| E2 | Queue consistency | Visit completion ran **after** the ticket was marked `DONE`. If visit completion failed, the queue could show **DONE** while the visit stayed **IN_PROGRESS**. | **Medium** |

**Verified as already sound (this pass):**

- **Staff vs doctor completion parity:** Both use `emr.completeVisitWithPolicy` (staff POST complete / doctor PATCH complete after ownership).  
- **Settlement idempotency:** `createSettlementLedgerForVisit` early-return when a ledger row exists; `updateVisit(COMPLETED)` triggers a single hook.  
- **Appointment sync:** `completeVisitWithPolicy` calls `appointmentService.completeAppointment` with transition guards; queue retains `ticket.appointmentId` sync for cases where the ticket’s appointment differs from the visit’s or visit had no `appointmentId`.  
- **Billing / payment-status:** Prior hardening (visits routes, `getBillingSummaryForVisit`, payment-status) aligns with [CLINIC_VISITS_RELEASE_READINESS.md](../../bpa_web/docs/CLINIC_VISITS_RELEASE_READINESS.md); not re-audited line-by-line here.

**Residual risks (manual / UI):**

- **UI refresh:** Staff queue/list should refetch on `emitQueueRealtime` / local mutation after complete; confirm in browser that visits and billing panels invalidate after queue complete.  
- **Role chain:** Queue complete uses existing clinic queue permissions on `completeService` route; visits module permissions unchanged.  
- **Strict branches:** If `allowOverrideWithReason` is **false** and requirements are unmet, queue **complete** fails with a clear error and the ticket stays **IN_SERVICE** (by design, after fix).

---

## 2. Fixes applied

1. **`completeService`** now calls **`emrService.completeVisitWithPolicy`** for `ticket.visitId`: first without override; on `COMPLETION_REQUIREMENTS_NOT_MET`, retries once with a fixed operational `overrideReason` when branch policy allows overrides.  
2. **Visit completion runs before** updating the ticket to `DONE`, so policy failures do not strand a completed ticket with an open visit.  
3. **`emr.completeVisitWithPolicy`** accepts optional **`auditOpts.completionSource`**; queue passes **`QUEUE_TICKET_DONE`** so audits distinguish queue-driven completions.  
4. Removed redundant raw `visit.update` + duplicate settlement fire from the queue path (settlement and room cleaning flow through **`updateVisit`**).

---

## 3. Files changed

| File | Change |
|------|--------|
| `backend-api/src/api/v1/modules/clinic/queue.service.ts` | Route visit completion through `completeVisitWithPolicy`; reorder vs ticket `DONE`. |
| `backend-api/src/api/v1/modules/clinic/emr.service.ts` | `auditOpts.completionSource` merged into `DoctorAuditLog.newValue`. |
| `backend-api/docs/DOCTOR_VISIT_COMPLETION_GOVERNANCE.md` | Document queue alignment + `completionSource`. |
| `backend-api/docs/CLINIC_QUEUE_VISIT_BILLING_SETTLEMENT_E2E_QA.md` | This QA record. |

---

## 4. Final operational verdict

**Backend chain (Queue → Visit → settlement hook → appointment sync):** **Aligned** with the hardened visit-completion governance after this fix. Queue completion is no longer a silent bypass; it shares policy, audit, room transition, and idempotent settlement with staff/doctor completion.

**Overall release statement:** **Conditionally ready** for the audited slice: run the step-by-step **[CLINIC_QUEUE_VISIT_SLICE_LIVE_SMOKE_CHECKLIST.md](./CLINIC_QUEUE_VISIT_SLICE_LIVE_SMOKE_CHECKLIST.md)** (queue start/complete, visit, appointment, settlement idempotency, room when `roomId` is set). Full product E2E beyond this slice remains governed by [CLINIC_E2E_FLOW_IMPLEMENTATION_AUDIT.md](./CLINIC_E2E_FLOW_IMPLEMENTATION_AUDIT.md) (pharmacy/injection/handover gaps).
