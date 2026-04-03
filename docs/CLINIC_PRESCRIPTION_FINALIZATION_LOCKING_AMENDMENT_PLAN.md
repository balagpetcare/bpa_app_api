# Clinic Prescription: Finalization, Locking, Amendment & Audit — Enterprise Design Plan

**Purpose:** Medico-legally sound target architecture for e-prescription lifecycle beyond the current MVP (draft → finalize → dispense). This document **does not** replace implementation code; it guides phased delivery and aligns with existing pharmacy and audit documentation.

**Status:** Planning / architecture (not implemented).

**Related documents (reuse before duplicating detail):**

| Document | Relevance |
|----------|-----------|
| [CLINIC_PHARMACY_MASTER_ARCHITECTURE.md](./CLINIC_PHARMACY_MASTER_ARCHITECTURE.md) | Pharmacy boundaries, dispense flows |
| [CLINIC_PHARMACY_DATA_AND_API_SPEC.md](./CLINIC_PHARMACY_DATA_AND_API_SPEC.md) | `Prescription` / `PrescriptionItem` model map, API surface |
| [CLINIC_PHARMACY_WORKFLOWS_AND_CONTROLS.md](./CLINIC_PHARMACY_WORKFLOWS_AND_CONTROLS.md) | Operational controls |
| [CLINIC_FLOW_AUDIT_TRAIL.md](./CLINIC_FLOW_AUDIT_TRAIL.md) | Implicit audit trail today; optional `ClinicFlowAuditLog` |
| [CLINIC_E2E_FLOW_IMPLEMENTATION_AUDIT.md](./CLINIC_E2E_FLOW_IMPLEMENTATION_AUDIT.md) | End-to-end gaps (historical) |

**Audience:** Product, engineering, compliance stakeholders.

---

## 1. Current prescription lifecycle (as implemented)

### 1.1 Data model (summary)

- **`Prescription`:** `visitId`, `petId`, `doctorId` (BranchMember), `qrToken`, `status`, `notes`, timestamps.
- **`PrescriptionItem`:** line-level medicine text + optional `productVariantId` / `clinicalItemVariantId`.
- **`PrescriptionStatus` enum:** `DRAFT` → `FINALIZED` → `DISPENSED`.

### 1.2 Behavioral rules (current)

- **Draft:** Editable by the **assigned prescribing veterinarian** (doctor panel + clinic API with veterinarian guard).
- **Finalize:** Transition `DRAFT` → `FINALIZED`; **no in-place edit** of content after finalize (API returns conflict / not editable).
- **Dispense:** Pharmacy-style path marks `FINALIZED` → `DISPENSED` (separate permission: medicine issue).
- **Non-doctors:** Read, print, QR verify (branch-scoped); no authoring.

### 1.3 Gaps vs enterprise expectations

| Gap | Risk |
|-----|------|
| No explicit **locked** flag separate from `FINALIZED` | “Locked” is implied by status; legal/policy may want time-bound or court-order lock |
| No **version / amendment** entity | Corrections require either void+reissue (not modeled) or informal workarounds |
| No **structured audit log** for prescription events | Relies on entity timestamps + `CLINIC_FLOW_AUDIT_TRAIL` implicit chain |
| No **print history** | Cannot prove who printed what and when |
| No **finalizedAt / finalizedByUserId** on row | Weaker attestation than typical e-Rx audit |

---

## 2. Design principles (medico-legal)

1. **Attribution:** Every clinical action ties to an identified prescriber (`doctorId` / user) and branch context.
2. **Integrity:** Once a prescription is **clinically binding**, its content should not change silently; any change is **explicit, attributable, and discoverable**.
3. **Non-repudiation (proportionate):** Finalization should record **who** and **when**; stronger crypto signatures are optional later.
4. **Least privilege:** Amendments are **not** silent edits; pharmacy/staff retain fulfill-and-audit roles, not prescriber roles.
5. **Regulatory proportionality:** Jurisdiction-specific rules (e.g. controlled drugs, retention years) inform retention and export—not all must be in v1.

---

## 3. Recommendation: immutability vs versioning

### 3.1 Finalized prescription: **immutable content**

**Recommendation:** Treat **`FINALIZED` (and `DISPENSED`) prescription records as immutable** at the line-item / snapshot level. Do **not** allow `PATCH` that mutates `PrescriptionItem` rows for those statuses.

**Rationale:**

- Aligns with common medico-legal practice: the record that was signed/finalized is what the patient, pharmacy, and regulators see.
- Simplifies disputes: “what was prescribed” is a stable artifact.
- Matches current API direction (409 on edit after finalize).

### 3.2 Corrections: **versioned amendments (additive), not silent overwrite**

**Recommendation:** Introduce **prescription versioning** or **amendment documents** as **new rows** (or new version chain) that **reference** the prior prescription.

**Preferred pattern (enterprise):**

- **`Prescription`** remains the “document header” for a **version chain**, OR each version is a **new** `Prescription` with `supersedesPrescriptionId` / `amendmentOfId` and a monotonic **`version`** or **`amendmentSequence`**.
- Only the **latest active** version is used for new fulfillment; **prior versions remain readable** for audit.

**Alternative (lighter):** `PrescriptionAmendment` child table with full JSON snapshot + reason; header stays one row. Heavier query UX; good for strict append-only.

**Anti-pattern:** Editing `PrescriptionItem` in place after finalize without audit trail.

### 3.3 “Locked” vs “finalized”

**Recommendation:** Keep **`FINALIZED` as the clinical lock** for content. Add optional **`lockedAt` / `lockedReason`** only if product needs:

- administrative lock (fraud hold),
- legal hold,
- or explicit “no further amendments” without voiding.

Otherwise, **`FINALIZED` + immutability + amendment workflow** is sufficient and avoids enum explosion.

---

## 4. Target state model

### 4.1 States (conceptual)

| State | Meaning | Content mutable? | Typical next |
|-------|---------|-------------------|--------------|
| **DRAFT** | Work in progress | Yes (prescriber only) | Finalize |
| **FINALIZED** | Clinically issued; binding snapshot | No (use amendment) | Dispense / partial fulfill / amendment |
| **DISPENSED** | Fulfillment completed (per product rules) | No | None or archival |
| **VOID** (future) | Cancelled with reason; not valid for dispense | No | — |
| **SUPERSEDED** (future) | Replaced by amendment | No | Point to successor |

*Whether `DISPENSED` is terminal or allows “partial dispense” is a product rule; pharmacy module may use `DispenseRequest` status separately.*

### 4.2 Amendment flow (conceptual)

1. Prescriber opens **finalized** Rx → UI offers **“Issue amendment”** (not “Edit”).
2. System creates **new version** (or amendment record) with **reason** (required), optional **free text**, copies prior lines as default, allows changes **only on the new version**.
3. **Prior version** marked `SUPERSEDED` or linked via FK; **new version** is `FINALIZED` after prescriber confirms.
4. **Audit** records: `AMENDMENT_CREATED`, `AMENDMENT_FINALIZED`, links between versions.

---

## 5. Schema suggestions (Prisma-level)

### 5.1 Extend `Prescription` (minimal attestation)

```prisma
// Suggested additions (migration in a future phase)
finalizedAt       DateTime?
finalizedByUserId Int?     // User.id (denormalized for audit; doctorId stays BranchMember)
lockedAt          DateTime? // optional policy lock
lockedReason      String?   @db.Text
voidedAt          DateTime?
voidReason        String?   @db.Text
supersedesId      Int?      // self-FK: this prescription amends/replaces prior
version           Int       @default(1)  // or amendmentSequence
```

Indexes: `(visitId, version)`, `(supersedesId)`, `(finalizedAt)`.

### 5.2 Optional: `PrescriptionAuditEvent` (append-only)

```prisma
model PrescriptionAuditEvent {
  id              Int      @id @default(autoincrement())
  prescriptionId  Int
  branchId        Int      // denormalized for branch-scoped queries
  eventType       String   @db.VarChar(64) // CREATED, UPDATED_DRAFT, FINALIZED, PRINTED, VIEWED, AMENDMENT_STARTED, DISPENSE_MARKED, VOIDED
  actorUserId     Int?
  actorBranchMemberId Int?
  payloadJson     Json?    // redacted snapshot ids, diff summary, print channel
  ipAddress       String?  @db.VarChar(45)
  userAgent       String?  @db.VarChar(512)
  createdAt       DateTime @default(now())

  prescription Prescription @relation(fields: [prescriptionId], references: [id], onDelete: Cascade)

  @@index([prescriptionId, createdAt])
  @@index([branchId, createdAt])
  @@map("prescription_audit_events")
}
```

*Alternatively*, adopt a single **`ClinicFlowAuditLog`** as described in [CLINIC_FLOW_AUDIT_TRAIL.md](./CLINIC_FLOW_AUDIT_TRAIL.md) with `stepType` including prescription events—**one** canonical audit stream is enough if queries are unified.

### 5.3 Print history

```prisma
model PrescriptionPrintEvent {
  id               Int      @id @default(autoincrement())
  prescriptionId   Int
  branchId         Int
  printedByUserId  Int
  printChannel     String   @db.VarChar(32) // STAFF_WEB, DOCTOR_WEB, KIOSK, EXPORT_PDF
  clientSessionId  String?  @db.VarChar(64)
  createdAt        DateTime @default(now())

  prescription Prescription @relation(fields: [prescriptionId], references: [id], onDelete: Cascade)

  @@index([prescriptionId, createdAt])
  @@map("prescription_print_events")
}
```

**Privacy:** Log **event**, not necessarily full Rx body again (body is on `Prescription` + items at that version).

---

## 6. API contract suggestions

### 6.1 Existing (preserve)

- `POST .../visits/:visitId/prescriptions` — create draft  
- `PATCH .../prescriptions/:id` — draft only  
- `POST .../prescriptions/:id/finalize`  
- `GET .../prescriptions/:id`, list by visit, QR verify  
- `POST .../prescriptions/:id/dispense` — pharmacy path  

### 6.2 Add (future)

| Endpoint | Purpose |
|----------|---------|
| `POST /prescriptions/:id/amendments` | Start amendment from finalized; returns draft amendment header or new prescription id |
| `POST /prescriptions/:id/void` | Void with reason (role-gated) |
| `GET /prescriptions/:id/versions` | Version chain for UI timeline |
| `GET /prescriptions/:id/audit` | Paginated audit events |
| `POST /prescriptions/:id/print-events` | Client reports print (or server logs on PDF generation) |

**Error codes:** Reuse `PRESCRIPTION_NOT_EDITABLE`; add `PRESCRIPTION_SUPERSEDED`, `PRESCRIPTION_VOIDED` as needed.

### 6.3 Response shape (doctor UI)

- Include `version`, `supersedesId`, `isLatestInChain`, `finalizedAt`, `finalizedBy` display name.
- List endpoints return **latest active** by default; **“history”** toggle loads chain.

---

## 7. Permission model

| Capability | Suggested key | Role |
|------------|---------------|------|
| Draft CRUD (own visit) | `clinic.prescription.create` / `.edit` / `.finalize` + vet staff profile | Prescriber |
| Read / print / QR | `clinic.prescription.read` | Staff, reception, etc. |
| Mark dispensed | `medicine.dispense.issue` (existing) | Pharmacy |
| **Issue amendment** | `clinic.prescription.amend` (new) or same as finalize with policy | Prescriber only |
| **Void** | `clinic.prescription.void` | Prescriber + optional owner/manager with break-glass |
| View audit / print history | `clinic.prescription.audit.read` | Manager / compliance |

*Clinic authoring routes accept only `clinic.prescription.create` / `.edit` / `.finalize`; `clinic.prescription.write` is retired from routing (see `CLINIC_PRESCRIPTION_WRITE_MIGRATION.md`).*

---

## 8. Audit model (events)

Minimum events to log (append-only):

| eventType | When |
|-----------|------|
| `PRESCRIPTION_CREATED` | After create |
| `PRESCRIPTION_DRAFT_UPDATED` | After PATCH (draft) |
| `PRESCRIPTION_FINALIZED` | After finalize; store `finalizedByUserId` |
| `PRESCRIPTION_PRINTED` | After print action / PDF |
| `PRESCRIPTION_AMENDMENT_CREATED` | New version started |
| `PRESCRIPTION_AMENDMENT_FINALIZED` | New version finalized |
| `PRESCRIPTION_DISPENSED` | Status → DISPENSED |
| `PRESCRIPTION_VOIDED` | If void introduced |

**Correlation:** `visitId`, `prescriptionId`, `branchId`, `actorUserId`, `requestId` / trace id from API middleware.

---

## 9. UI states (WowDash-consistent, no redesign mandate)

| State | Doctor panel | Staff panel |
|-------|--------------|-------------|
| DRAFT | Edit, finalize, discard (if product allows) | View-only + print disabled or “draft” watermark (product choice) |
| FINALIZED | Read-only + **Amend** (opens amendment wizard) + print | View + print + QR |
| DISPENSED | Read-only + history | Read-only + print |
| Amendment in progress | Same as draft but banner “Amending Rx #n” | Hidden or read-only parent until new version finalized |

**Print:** Every print triggers **client call** to log print event (or server-generated PDF logs server-side).

---

## 10. Rollout strategy (phased)

### Phase 0 — **Done / baseline** (reference)

- Veterinarian-only authoring; immutable after finalize (API enforcement).
- Branch-safe read/print/QR.

### Phase 1 — **Attestation & audit MVP** (low risk)

- Add `finalizedAt`, `finalizedByUserId` to `Prescription`; backfill from `updatedAt` where status = FINALIZED (best-effort).
- Emit audit events for: created, draft updated, finalized, dispensed (service hooks).
- Optional: `PrescriptionPrintEvent` + one API to record print.

### Phase 2 — **Versioning / amendments**

- Add `supersedesId`, `version` (or separate `PrescriptionAmendment` table—pick one model).
- Implement `POST .../amendments` + UI wizard; mark prior `SUPERSEDED` or link only.
- Permissions: `clinic.prescription.amend`.

### Phase 3 — **Void, lock, compliance exports**

- Void with reason; optional `lockedAt` for legal hold.
- Export package: Rx chain + audit + print history for retention (per jurisdiction).

### Phase 4 — **Advanced**

- Electronic signature integration, controlled-substance schedules, integration with national e-Rx where applicable.

---

## 11. Open decisions (product / legal)

1. **Partial dispense:** Multiple dispense events vs single `DISPENSED`—align with `DispenseRequest` partial issue states.
2. **Draft visibility to staff:** Print draft allowed or forbidden until finalized?
3. **Who may void:** Only prescriber vs owner break-glass with dual control.
4. **Retention period** and **PII in audit payload** (minimize; store ids + hashes where possible).

---

## 12. Executive recommendation (summary)

| Topic | Decision |
|-------|----------|
| Finalized content | **Immutable** — no silent item edits |
| Corrections | **Versioned amendments** (new prescription row or explicit amendment entity) with required reason |
| “Locked” | **Use FINALIZED as clinical lock**; add `lockedAt` only if policy requires |
| Audit | **Append-only events** (`PrescriptionAuditEvent` **or** unified `ClinicFlowAuditLog`) |
| Print | **Dedicated print events** for accountability |
| Rollout | **Phase 1 attestation + audit**, then **Phase 2 amendments**, then void/export |

This plan extends—not replaces—[CLINIC_PHARMACY_DATA_AND_API_SPEC.md](./CLINIC_PHARMACY_DATA_AND_API_SPEC.md) and [CLINIC_FLOW_AUDIT_TRAIL.md](./CLINIC_FLOW_AUDIT_TRAIL.md). Implementation tickets should reference this file and link migrations to explicit phases.

---

*Document version: 1.0 · Last updated: 2026-03-21*
