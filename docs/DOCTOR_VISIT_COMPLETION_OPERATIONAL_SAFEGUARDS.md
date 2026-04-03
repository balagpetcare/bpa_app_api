# Phase 6 — Visit Completion Operational Safeguards

## 1. Gaps closed

| Area | Before | After |
|------|--------|--------|
| **Audit when profile missing** | No audit row if visit’s doctor had no `clinicStaffProfileId` or `completedByUserId` was set. | Audit is **always** written when `completedByUserId` is available. Profile is resolved from (1) visit’s doctor, (2) completer’s BranchMember in same branch; else `clinicStaffProfileId` is stored as null (fallback). |
| **Silent skip** | Completion could succeed with no audit when profile was missing. | Completion events are not silently skipped when `completedByUserId` is present; every such completion gets one DoctorAuditLog row. |
| **Override reason privacy** | No UI guidance; report exposed full override reason. | UI: helper text and max length (500); report supports `maskOverrideReason=true` to redact override reason in `recentOverrides`. |
| **Report safety/performance** | No date cap; unbounded recent list. | Date range capped at 365 days; `recentOverrides` limited (default 20, max 100 via `recentLimit`); from &lt;= to validated. |
| **Indexing** | Only `(branchId, action)` documented. | Documented recommendation to add `(branchId, action, createdAt)` if query volume grows. |

---

## 2. What remains (policy / ops)

### Edge cases: when audit is still absent
- **No `completedByUserId`:** Completion triggered without an authenticated user (e.g. system job, legacy integration, or bug) does not write an audit row. Normal doctor UI always sends the authenticated user, so this is rare.
- **Database/transaction failure:** If `doctorAuditLog.create` fails after the visit is already updated, completion succeeds but the audit row may be missing; consider retry or application logging for create failures.

### Other policy/ops
- **Override reason** is still stored in full in `DoctorAuditLog.newValue`; masking applies only to the report API response. Exports or direct DB access can expose it; treat as policy/access control.
- **Retention** of DoctorAuditLog is not enforced by code; define retention and archival as org policy.
- **Who may see unmasked reasons:** Current permission is `clinic.emr.read` or `clinic.overview.read`. Restricting unmasked access to a higher privilege (e.g. compliance role) is a product/ops decision.

---

## 3. Files changed

| File | Change |
|------|--------|
| `prisma/schema.prisma` | `DoctorAuditLog.clinicStaffProfileId` made optional (`Int?`); relation `ClinicStaffProfile?`. |
| `prisma/migrations/20260327120000_doctor_audit_log_profile_optional/migration.sql` | **New.** `ALTER COLUMN "clinicStaffProfileId" DROP NOT NULL`. |
| `doctor/doctor.service.ts` | completeVisit: resolve profile from visit’s doctor, then from completer’s BranchMember in branch; always create audit when `completedByUserId` is set; allow `clinicStaffProfileId` null. |
| `bpa_web/app/doctor/(larkon)/visits/[id]/page.tsx` | Override reason textarea: maxLength 500; form-text guidance to avoid patient names/IDs and note report use. |
| `clinic/clinicReports.service.ts` | getVisitCompletionAuditSummary: opts `maskOverrideReason`, `recentLimit`; cap recentOverrides; constants for max days and recent limit. |
| `clinic/clinicEnterprise.controller.ts` | getVisitCompletionAuditReport: validate from &lt;= to and span &lt;= 365 days; pass `maskOverrideReason`, `recentLimit` from query. |
| `docs/DOCTOR_VISIT_COMPLETION_AUDIT_REPORTING.md` | (Phase 5) No change; Phase 6 extends behavior. |
| `docs/DOCTOR_VISIT_COMPLETION_OPERATIONAL_SAFEGUARDS.md` | **New.** This document. |

---

## 4. Recommended production settings

- **Visit completion audit report**
  - Use **default date range** (e.g. last 30 days) for dashboards; request longer ranges only when needed.
  - For shared or compliance views, call with **`maskOverrideReason=true`** so override reasons are redacted in `recentOverrides`.
  - Keep **`recentLimit`** at default (20) unless a specific screen needs more; max 100.
- **Indexing (when volume grows)**  
  Add composite index for the visit-completion-audit query so range scans on `createdAt` are efficient:

  ```sql
  CREATE INDEX CONCURRENTLY IF NOT EXISTS doctor_audit_logs_branchId_action_createdAt_idx
  ON doctor_audit_logs(branchId, action, createdAt DESC);
  ```

  Existing `(branchId, action)` remains useful; the above improves queries that filter by date range. Add via a migration when log volume per branch is high.
- **Override reason**
  - Rely on UI guidance (workflow/clinical reasons only; avoid PII).
  - Prefer masked report for broad access; restrict unmasked to roles that need it.

---

## 5. Future analytics extensions

- **Override rate trends:** Override rate by week/month and by branch (already have data in DoctorAuditLog).
- **Per-doctor breakdown:** Override count and most common unmet by `clinicStaffProfileId` (or by completer when profile is null) for coaching.
- **Alerts:** Threshold-based alerts (e.g. override rate &gt; X% in a period) for branch/org admins.
- **Export:** CSV/Excel of recent overrides with optional masking (reuse `maskOverrideReason`).
- **Retention/archival:** Scheduled job to archive or aggregate old DoctorAuditLog rows per org policy.
