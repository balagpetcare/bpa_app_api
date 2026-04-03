# Doctor Module — Release Status & Rollout Pack

**Canonical release document** for the full doctor workflow (Phases 1–7). Use for QA, rollout, and maintenance.

---

## 1. Scope completed (all phases)

| Phase | Scope |
|-------|--------|
| **1–3** | Appointment list/detail wired to visit workspace; Start Consult creates visit when missing; Open Visit from list and detail when IN_CONSULT; tabbed visit workspace (History, Vitals, SOAP, Tests, Prescription, Plan, Billing, Token, Follow-up, Attachments, Complete); completion confirmation. |
| **4** | Visit completion governance: configurable branch policy (SOAP, assessment, vitals, optional rx/plan for consultation); GET completion-eligibility; PATCH complete with optional override reason; completion guard modal (checklist + override). |
| **5** | Audit: every completion (and override) written to DoctorAuditLog; branch report endpoint for totals, override count, recent overrides, most common unmet. |
| **6** | Operational safeguards: fallback audit when profile unresolved (optional clinicStaffProfileId); override reason UI guidance and max length; report masking (`maskOverrideReason`), date-range cap (365 days), recentLimit (default 20, max 100). |
| **7** | This release doc, QA/UAT checklist, deployment checklist. |

---

## 2. Canonical doctor user flow

1. **Dashboard** → Appointments (list).
2. **List:** Filter by date/branch/status; **Start Consult** on appointment → creates visit if missing, status → IN_CONSULT; **Open Visit** when IN_CONSULT and visit exists → navigates to `/doctor/visits/[visitId]`.
3. **Appointment detail:** Patient snapshot, alerts, history; **Start Treatment** / **Start Consult** → same as list; **Open Visit** when IN_CONSULT → same navigation. QuickActionBar shows Open Visit when IN_CONSULT.
4. **Visit workspace** (tabs): History, Vitals, SOAP, Tests, Prescription, Plan, Billing, Token, Follow-up, Attachments, **Complete**.
5. **Complete:** User clicks **Complete visit** → frontend calls GET `/doctor/visits/:id/completion-eligibility`:
   - **Eligible:** Confirm dialog → PATCH complete (no body) → visit + appointment COMPLETED.
   - **Not eligible:** Modal with unmet list; if override allowed, user enters reason → **Complete anyway** → PATCH with `{ overrideReason }` → same completion + audit as override.
6. Every completion is audited (DoctorAuditLog); managers can use the visit-completion-audit report.

---

## 3. Visit completion policy (defaults)

- **Source:** `BranchPolicy.customPoliciesJson.visitCompletion` (branch-level JSON). Missing key = default.
- **Defaults:**

| Key | Default | Meaning |
|-----|---------|--------|
| requireSoapNote | true | At least one SOAP note. |
| requireAssessment | true | At least one SOAP with non-empty Assessment/Diagnosis. |
| requireVitals | true | At least one vital on visit or intake vitals on appointment. |
| requirePrescriptionOrPlanForConsultation | false | For consultation type: at least one prescription or treatment course. |
| allowOverrideWithReason | true | When not eligible, completion allowed with non-empty overrideReason. |
| followUpOnlyRelaxed | true | FOLLOW_UP: vitals and prescription/plan not required. |
| emergencyRelaxed | true | EMERGENCY: vitals and prescription/plan not required. |

---

## 4. Override behavior

- When eligibility check returns **not eligible** and policy **allowOverrideWithReason** is true, frontend shows:
  - List of unmet requirements.
  - Required textarea: “Reason for completing anyway” (max 500 chars; guidance: workflow/clinical reasons only, avoid patient names/IDs).
  - Button **Complete anyway** → PATCH with `{ overrideReason: "…" }`.
- Backend: same eligibility check on PATCH; if not eligible and no valid (non-empty trimmed) overrideReason → **400** with `code: "COMPLETION_REQUIREMENTS_NOT_MET"` and `unmet`.
- Override is written to DoctorAuditLog as action `VISIT_COMPLETED_OVERRIDE` with overrideReason, unmet, and visitContext in newValue.

---

## 5. Audit & report endpoints

| Method | Path | Purpose |
|--------|------|--------|
| GET | `/api/v1/doctor/visits/:id/completion-eligibility` | Eligibility + unmet + canOverride (doctor auth). |
| PATCH | `/api/v1/doctor/visits/:id/complete` | Complete visit (body: `{}` or `{ overrideReason }`). |
| GET | `/api/v1/clinic/branches/:branchId/reports/visit-completion-audit` | Branch report: totalCompleted, completedWithOverride, overrideRate, recentOverrides, mostCommonUnmet. Clinic permission: `clinic.emr.read` or `clinic.overview.read`. |

**Report query params:**

- `from`, `to` (YYYY-MM-DD): default last 30 days to today. Span must be ≤ 365 days; from ≤ to.
- `maskOverrideReason=true`: redact override reason in `recentOverrides` as `[REDACTED]`.
- `recentLimit`: number of recent overrides (default 20, max 100).

---

## 6. Operational safeguards

- **Audit:** Completion is always written to DoctorAuditLog when `completedByUserId` is present; profile resolved from visit’s doctor or completer’s BranchMember; else `clinicStaffProfileId` null (fallback). Migration: `clinicStaffProfileId` optional on `doctor_audit_logs`.
- **Override reason:** UI guidance + max 500 chars; report can mask for privacy.
- **Report:** Date range ≤ 365 days; recentOverrides capped; from ≤ to validated.
- **Indexing (optional at scale):** `(branchId, action, createdAt DESC)` on `doctor_audit_logs` if volume grows (see Phase 6 doc).

---

## 7. Migration requirements

- **Required:** `prisma migrate deploy` so that:
  - All prior doctor/visit/audit migrations are applied.
  - **Phase 6:** `20260327120000_doctor_audit_log_profile_optional` (clinicStaffProfileId optional on doctor_audit_logs).

---

## 8. Known limitations

- **Audit absent** when completion is triggered without authenticated user (e.g. system/legacy) or if audit insert fails after visit update.
- **Override reason** is stored in full in DoctorAuditLog; masking only in report API. Exports/DB access can expose it; control by access and retention policy.
- **Retention** of DoctorAuditLog not enforced in code; define per org.
- **Diagnosis** remains in SOAP Assessment only; no separate VisitDiagnosis entity (see governance doc).

---

## 9. Recommended production settings

- **Visit completion audit report:** Default date range (e.g. 30 days) for dashboards; use `maskOverrideReason=true` for shared/compliance views; keep recentLimit at 20 unless a screen needs more (max 100).
- **Override reason:** Rely on UI guidance; prefer masked report for broad access.
- **Branch policy:** Verify or set `visitCompletion` in branch_policies where defaults are not desired.

---

## 10. Future backlog items

- Override rate trends (by week/month, by branch).
- Per-doctor override breakdown and most common unmet (coaching).
- Alerts (e.g. override rate > X% in period).
- CSV/Excel export of recent overrides with optional masking.
- DoctorAuditLog retention/archival job.
- Optional index `(branchId, action, createdAt DESC)` when log volume is high.

---

## 11. QA / UAT checklist

Use for QA and UAT sign-off.

### Appointment without visit
- [ ] List: Start Consult on appointment without visit creates visit and sets status IN_CONSULT; response or refetch shows visit.id.
- [ ] Detail: Start Treatment / Start Consult same behavior; after start, Open Visit appears when IN_CONSULT.

### Appointment with visit
- [ ] List: For IN_CONSULT with visit, Open Visit visible and navigates to `/doctor/visits/[visitId]`.
- [ ] Detail: Open Visit in quick actions and main actions navigates to visit workspace.

### Appointment detail actions
- [ ] Call, Start Consult, Complete (when applicable), Confirm, Reschedule, Cancel work as designed.
- [ ] Open Visit only when status IN_CONSULT and visit exists.

### Visit workspace tabs
- [ ] History, Vitals, SOAP, Tests, Prescription, Plan, Billing, Token, Follow-up, Attachments load without error.
- [ ] Complete tab shows “Complete visit” and triggers completion flow.

### Completion eligibility — pass
- [ ] Visit with SOAP (with Assessment), vitals (or intake vitals), and policy met: GET completion-eligibility returns eligible true.
- [ ] Complete visit → confirmation → complete with empty body → visit and appointment COMPLETED; audit row VISIT_COMPLETED.

### Completion eligibility — fail
- [ ] Visit missing SOAP or Assessment or vitals (and not FOLLOW_UP/EMERGENCY relaxed): GET returns eligible false, unmet list populated.
- [ ] Complete visit → modal with unmet list; without override reason, cannot submit.

### Override with reason
- [ ] When not eligible and canOverride true: enter reason → Complete anyway → PATCH with overrideReason → visit and appointment COMPLETED.
- [ ] Audit row VISIT_COMPLETED_OVERRIDE with overrideReason and unmet in newValue.
- [ ] Empty or whitespace-only reason: Complete anyway disabled or backend returns 400.

### Masked vs unmasked reporting
- [ ] GET visit-completion-audit without maskOverrideReason: recentOverrides include full overrideReason (when permission allows).
- [ ] GET with maskOverrideReason=true: recentOverrides show overrideReason as "[REDACTED]".

### Date range validation
- [ ] from > to: 400 with validation error.
- [ ] Span > 365 days: 400 with message that range must not exceed 365 days.
- [ ] Valid from/to: 200 and correct period in response.

### recentLimit behavior
- [ ] Default (no recentLimit): recentOverrides length ≤ 20.
- [ ] recentLimit=5: recentOverrides length ≤ 5.
- [ ] recentLimit=200 (above max 100): effective cap 100.

---

## 12. Deployment checklist

Use at release / rollout.

### Database
- [ ] Run `npx prisma migrate deploy` (or equivalent) in backend-api; confirm migration `20260327120000_doctor_audit_log_profile_optional` applied if Phase 6 is in release.
- [ ] No manual data changes required for default behavior.

### Permissions
- [ ] Doctor routes: authenticated doctor (user has ClinicStaffProfile staffType=DOCTOR for at least one branch); visit/complete scoped to doctor’s branch member IDs.
- [ ] Visit-completion-audit report: `clinic.emr.read` or `clinic.overview.read` for the branch; verify intended roles have one of these.

### Branch policy
- [ ] Optional: For branches that need different completion rules, set `BranchPolicy.customPoliciesJson.visitCompletion` (see §3). If not set, defaults apply.

### Smoke-test routes
- [ ] GET `/api/v1/doctor/visits/:id` (valid visit id for doctor) → 200.
- [ ] GET `/api/v1/doctor/visits/:id/completion-eligibility` → 200, body has eligible, unmet, canOverride.
- [ ] PATCH `/api/v1/doctor/visits/:id/complete` with `{}` on eligible visit → 200; visit and appointment COMPLETED.
- [ ] GET `/api/v1/clinic/branches/:branchId/reports/visit-completion-audit` with clinic token → 200; body has totalCompleted, completedWithOverride, recentOverrides, mostCommonUnmet.

### Report endpoint verification
- [ ] Same report with `from`, `to` in range → 200.
- [ ] Same report with `from` > `to` → 400.
- [ ] Same report with span > 365 days → 400.
- [ ] Same report with `maskOverrideReason=true` → 200; override reasons in recentOverrides redacted.

---

## Related docs

- `DOCTOR_VISIT_COMPLETION_GOVERNANCE.md` — Completion rules, config, flow, diagnosis note.
- `DOCTOR_VISIT_COMPLETION_AUDIT_REPORTING.md` — Phase 5 audit and report.
- `DOCTOR_VISIT_COMPLETION_OPERATIONAL_SAFEGUARDS.md` — Phase 6 safeguards, indexing, production settings.
- `DOCTOR_TREATMENT_WORKSPACE.md` — Visit workspace and doctor APIs summary.
- `DOCTOR_MODULE_AUDIT_AND_PLAN.md` — Original audit and implementation plan.
