# Phase 5 — Visit Completion Audit & Reporting

## 1. Current audit coverage

### Before Phase 5
- **None.** Visit completion and override were not written to any audit table or log. Only a code comment indicated intent to write to an audit table. Actor, timestamp, visit/appointment/branch, and unmet-requirements context were not recorded.

### After Phase 5
- **DoctorAuditLog:** Every completion (normal and override) writes one row:
  - **Action:** `VISIT_COMPLETED` or `VISIT_COMPLETED_OVERRIDE`.
  - **Scope:** `orgId`, `branchId`, `clinicStaffProfileId` (from visit’s doctor), `changedByUserId`, `changedByRole: "DOCTOR"`, `createdAt`.
  - **newValue (JSON):** `visitId`, `appointmentId`, `completedAt` (ISO), `completedByUserId`, `overrideUsed`, `overrideReason` (if override), `unmet` (array at time of override), `visitContext: { isEmergency, isFollowUpOnly }`.
- **Reporting:** Branch-scoped report endpoint reads from `DoctorAuditLog` and exposes totals, override count, recent overrides, and most common unmet requirements.

---

## 2. Changes made

### A. Audit enrichment (Task B)
- **completeVisit** now:
  - Accepts optional `completedByUserId` (from auth).
  - Loads visit with `orgId` and `doctorId`; after successful EMR + appointment update, resolves `clinicStaffProfileId` from `BranchMember` for the visit’s doctor.
  - Writes `DoctorAuditLog` with action `VISIT_COMPLETED` or `VISIT_COMPLETED_OVERRIDE` and `newValue` containing:
    - completed by (`completedByUserId`), completed at (`completedAt`), override used, override reason, unmet at time of override, visit context (isEmergency, isFollowUpOnly).
  - Audit write is best-effort: if `clinicStaffProfileId` is missing or `completedByUserId` is not provided, completion still succeeds; audit row may be skipped.

### B. Reporting / admin visibility (Task C)
- **Endpoint:** `GET /api/v1/clinic/branches/:branchId/reports/visit-completion-audit`
  - **Query:** Optional `from`, `to` (YYYY-MM-DD). Default: last 30 days to today.
  - **Permission:** `clinic.emr.read` or `clinic.overview.read` (reuses existing clinic report access).
  - **Response:**
    - `branchId`, `period: { from, to }`
    - `totalCompleted`, `completedWithOverride`, `overrideRate` (percentage)
    - `recentOverrides`: last 20 override events with visitId, completedAt, overrideReason, unmet, visitContext, completedByUserId, createdAt
    - `mostCommonUnmet`: top 10 unmet requirement labels with counts (from override logs’ `unmet` arrays)
- Implemented in existing `clinicReports.service` and clinic report controller; no new subsystem.

---

## 3. Files changed

| File | Change |
|------|--------|
| `backend-api/src/api/v1/modules/doctor/doctor.service.ts` | `completeVisit(visitId, doctorBranchMemberIds, body?, completedByUserId?)`; load visit with orgId, doctorId; after completion write DoctorAuditLog (VISIT_COMPLETED / VISIT_COMPLETED_OVERRIDE) with full newValue payload; resolve clinicStaffProfileId from BranchMember. |
| `backend-api/src/api/v1/modules/doctor/doctor.controller.ts` | Pass `req.user?.id` into `completeVisit` as fourth argument. |
| `backend-api/src/api/v1/modules/clinic/clinicReports.service.ts` | `getVisitCompletionAuditSummary(branchId, dateFrom, dateTo)`: query DoctorAuditLog by branch and action; return totalCompleted, completedWithOverride, overrideRate, recentOverrides, mostCommonUnmet. |
| `backend-api/src/api/v1/modules/clinic/clinicEnterprise.controller.ts` | `getVisitCompletionAuditReport`: branchId from params; optional from/to (default last 30 days); call getVisitCompletionAuditSummary. |
| `backend-api/src/api/v1/modules/clinic/clinic.routes.ts` | GET `/branches/:branchId/reports/visit-completion-audit` with requireClinicPermission("clinic.emr.read", "clinic.overview.read") → getVisitCompletionAuditReport. |
| `backend-api/docs/DOCTOR_VISIT_COMPLETION_AUDIT_REPORTING.md` | This document. |

---

## 4. Risks / follow-up

- **Retention:** DoctorAuditLog has no defined retention; consider policy and archival for long-term compliance.
- **PII in override reason:** Override reason is free text; may contain patient or operator identifiers. Restrict who can query the report and consider masking in exports.
- **Missing audit row:** If `completedByUserId` is not set (e.g. legacy or system call), no audit row is created; completion still succeeds. When `completedByUserId` is set, Phase 6 ensures a row is always written (using fallback profile or null `clinicStaffProfileId`). See `DOCTOR_VISIT_COMPLETION_OPERATIONAL_SAFEGUARDS.md`.
- **Performance:** Report aggregates all completion logs in date range in memory; for very high volume, add pagination or cap date range.

---

## 5. Recommended future analytics path

- **Trends:** Override rate over time (by week/month) and by branch for “branches using override frequently” visibility.
- **Per-doctor breakdown:** Override count and most common unmet by doctor (clinicStaffProfileId) for coaching and policy tuning.
- **Alerts:** Optional threshold (e.g. override rate > X% in a week) to notify branch or org admins.
- **Export:** CSV/Excel export of recent overrides for compliance or internal review, with optional PII masking for override reason.
