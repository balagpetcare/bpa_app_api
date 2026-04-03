# Phase 4 — Doctor Visit Completion Governance

## 1. Current completion flow (implemented)

- **Frontend:** Visit workspace → eligibility → `PATCH /api/v1/doctor/visits/:id/complete` with `{}` or `{ overrideReason }` (see §6).
- **Backend:** `doctor.service.completeVisit` enforces **doctor ownership** (`visit.doctorId ∈ doctor’s branch member IDs`), then delegates to **`emr.service.completeVisitWithPolicy`** — the **same** canonical path as staff `POST /clinic/branches/:branchId/visits/:visitId/complete` and **`queue.service.completeService`** when the ticket has a `visitId` (policy, optional operational override from queue when allowed, `updateVisit` → room cleaning + settlement hook, appointment sync, idempotent ledger). Queue completions set `completionSource: "QUEUE_TICKET_DONE"` on the audit `newValue`.
- **Audit:** `DoctorAuditLog` with `changedByRole: DOCTOR` and the same `newValue` shape as before (no `actor` field; staff completions still set `actor: "STAFF_CLINIC"`).

---

## 2. New rules added

- **requireSoapNote** (default true): At least one SOAP note on the visit.
- **requireAssessment** (default true): At least one SOAP note with non-empty Assessment/Diagnosis in `contentJson.assessment`.
- **requireVitals** (default true): At least one vital record on the visit **or** intake vitals (weight/temp/HR/RR) on the linked appointment.
- **requirePrescriptionOrPlanForConsultation** (default false): For consultation-type appointments, at least one prescription or one treatment course.
- **allowOverrideWithReason** (default true): When requirements are not met, completion is allowed if the client sends a non-empty `overrideReason` (audit-ready).
- **followUpOnlyRelaxed** (default true): When `appointmentType === "FOLLOW_UP"`, vitals and prescription/plan are not required.
- **emergencyRelaxed** (default true): When `priority === "EMERGENCY"`, vitals and prescription/plan are not required.

---

## 3. Configurability model

- **Source:** Branch-level policy in `BranchPolicy.customPoliciesJson.visitCompletion` (JSON object).
- **Shape:** Optional keys override defaults; missing key = use default.

Example (branch policy JSON):

```json
{
  "visitCompletion": {
    "requireSoapNote": true,
    "requireAssessment": true,
    "requireVitals": true,
    "requirePrescriptionOrPlanForConsultation": false,
    "allowOverrideWithReason": true,
    "followUpOnlyRelaxed": true,
    "emergencyRelaxed": true
  }
}
```

- **Module:** `src/api/v1/modules/doctor/visitCompletionPolicy.ts` (getPolicy, checkVisitCompletionEligibility). No DB migration; uses existing `branch_policies.custom_policies_json`.
- **Flow:** Completion calls `checkVisitCompletionEligibility(visitId, doctorIds)`; if not eligible and no valid `overrideReason`, backend throws with `code: "COMPLETION_REQUIREMENTS_NOT_MET"` and `unmet` list; frontend shows checklist and optional override with reason.

---

## 4. Files changed

| File | Change |
|------|--------|
| `backend-api/src/api/v1/modules/doctor/visitCompletionPolicy.ts` | **New.** Branch policy read, default policy, eligibility check (SOAP, assessment, vitals, consultation rx/plan, emergency/follow-up relaxed). |
| `backend-api/src/api/v1/modules/doctor/doctor.service.ts` | `getCompletionEligibility`; `completeVisit` validates **ownership** then calls `emr.completeVisitWithPolicy(..., { changedByRole: "DOCTOR" })`. |
| `backend-api/src/api/v1/modules/clinic/emr.service.ts` | `completeVisitWithPolicy` — shared implementation for staff + doctor; enforces `canOverride` when branch policy disables override. |
| `backend-api/src/api/v1/modules/doctor/doctor.controller.ts` | `getCompletionEligibility` handler; `completeVisit` reads `req.body.overrideReason`, catches `COMPLETION_REQUIREMENTS_NOT_MET` and returns 400 with `unmet`. |
| `backend-api/src/api/v1/modules/doctor/doctor.routes.ts` | `GET /visits/:id/completion-eligibility` added. |
| `bpa_web/lib/api.ts` | `doctorGetCompletionEligibility(visitId)`; `doctorCompleteVisit(visitId, body?)` with optional `overrideReason`. |
| `bpa_web/app/doctor/(larkon)/visits/[id]/page.tsx` | Completion guard: on "Complete visit", fetch eligibility; if eligible → confirm → complete; if not → show modal with unmet list and optional override reason + "Complete anyway". |
| `backend-api/docs/DOCTOR_VISIT_COMPLETION_GOVERNANCE.md` | This document. |

---

## 5. Risks / compatibility notes

- **Existing branches:** No `visitCompletion` in `customPoliciesJson` → default policy (SOAP + assessment + vitals required, override allowed). Visits without SOAP/vitals will require override or adding data.
- **API contract:** `PATCH /visits/:id/complete` accepts optional body `{ overrideReason?: string }`. Sending `{}` is still valid when eligible.
- **Override enforcement:** If `visitCompletion.allowOverrideWithReason` is **false**, sending `overrideReason` no longer completes the visit — same rule applies to **staff** clinic completion (shared `completeVisitWithPolicy`).
- **Audit:** Every completion (and override) is written to `DoctorAuditLog` with action `VISIT_COMPLETED` or `VISIT_COMPLETED_OVERRIDE`; doctor rows use `changedByRole: DOCTOR`. See `DOCTOR_VISIT_COMPLETION_AUDIT_REPORTING.md`.
- **Permission:** No new roles; same doctor auth (visit must belong to doctor’s branch member ids). No separate “override” permission.
- **Live smoke (queue + staff + doctor parity):** [CLINIC_QUEUE_VISIT_SLICE_LIVE_SMOKE_CHECKLIST.md](./CLINIC_QUEUE_VISIT_SLICE_LIVE_SMOKE_CHECKLIST.md).

---

## 6. Final doctor completion logic

1. Doctor clicks **Complete visit** in the Visit workspace.
2. Frontend calls **GET /doctor/visits/:id/completion-eligibility**.
3. If **eligible:** Frontend shows confirmation → **PATCH .../complete** with `{}` → visit and linked appointment marked COMPLETED.
4. If **not eligible:** Frontend shows modal with:
   - List of unmet requirements.
   - If **canOverride:** Textarea “Reason for completing anyway” and button **Complete anyway** → **PATCH .../complete** with `{ overrideReason: "…" }`.
   - If **!canOverride:** Message “Add the missing items above and try again” (no submit).
5. Backend: On PATCH, run same eligibility check; if not eligible and no valid `overrideReason`, return **400** with `code: "COMPLETION_REQUIREMENTS_NOT_MET"` and `unmet`; otherwise complete visit and appointment as before.

---

## D. Diagnosis normalization review

- **Current:** Diagnosis is captured in SOAP **Assessment** (`ClinicalNote.contentJson.assessment`). There is no separate Diagnosis model or visit-level diagnosis entity.
- **Conclusion:** No change for Phase 4. Keeping diagnosis inside SOAP Assessment is consistent with existing workflows and avoids duplicate UI and sync issues.
- **Rationale:**
  - Completion rules already require “at least one SOAP note with Assessment/Diagnosis,” so diagnosis is enforced where it lives today.
  - A separate diagnosis entity would require schema, APIs, and UI; no strong architectural need was identified for this phase.
- **Future migration path (if needed):**
  - Add a `VisitDiagnosis` (or similar) model and optional API to record coded/freetext diagnoses linked to the visit.
  - Backfill from SOAP Assessment (e.g. parse or copy from latest SOAP note) and/or allow dual capture during a transition period.
  - Completion policy could then add an optional “requireStructuredDiagnosis” rule. Until then, SOAP Assessment remains the single source for diagnosis in the doctor workflow.
