# Wave-4 Enterprise Hardening — Financial / SLA / Command Center

**Path:** `docs/WAVE4_ENTERPRISE_HARDENING_REPORT.md`
**Scope:** Final review of cost attribution, SLA logic, exception noise, org isolation, UI triage, indexes, and QA checklist.

---

## Backend

### Cost attribution & CTS

| Topic | Finding | Resolution |
|-------|---------|------------|
| **Confidence field** | Global `linesWithCost/totalGrnLines` was applied to every variant×branch row (misleading). | **Per-row coverage**: `confidence` = lines with `unitCost` / lines in that branch×variant bucket; `breakdownJson` stores org-wide and per-key counts. |
| **CTS detail API** | Variant/branch could theoretically be cross-org if IDs guessed. | **Defense in depth**: `getCtsDetail` verifies `branch.orgId` and `productVariant.product.orgId` before returning summary/facts. |
| **Top branches join** | Branch names loaded by id only. | **`branch.findMany({ orgId, id: { in } })`** so names cannot leak from another org. |

### SLA

| Topic | Finding | Resolution |
|-------|---------|------------|
| **Zero dispatches** | `measuredValue` forced to 100% when `sampleCount === 0` (implies perfect SLA with no data). | **`measuredValue: null`** when no dispatches; `calculationTrace.noDispatchesInWindow: true`. |
| **Discrepancy SLO** | Single `sampleCount: 1` was arbitrary. | **`measuredValue`** = window-created PENDING count; **`breachCount`** = **all** org-wide PENDING (operational load); trace documents both `openDiscrepanciesWindowed` and `openDiscrepanciesAllPending`. |

### Exceptions — duplication & noise

| Topic | Finding | Resolution |
|-------|---------|------------|
| **Stale OPEN rows** | Index not updated when discrepancy resolved / recall closed / request unstuck in source. | **`reconcileStaleExceptionIndex(orgId)`** runs at start of each refresh: resolves index rows whose source left the active queue. |
| **Stock request stuck** | `submittedAt` null could match incorrectly. | Query requires **`submittedAt: { not: null, lt: … }`**; stuck logic aligned with **`isStockRequestStillStuck`**. |
| **Acknowledge on resolved** | No-op could still bump version if added later. | **`patchException`**: skip acknowledge when status is already **RESOLVED**. |

### Audit completeness

| Topic | Resolution |
|-------|------------|
| **RCA** | After `upsertRca`, parent exception **`timelineJson`** gets a **`RCA`** event (actor + cause). |
| **Reconcile** | Auto-close appends **`RECONCILE`** timeline event. |
| **Patch** | Existing **ACK / ASSIGN / STATUS** timeline behavior unchanged. |

---

## Frontend

| Topic | Resolution |
|-------|------------|
| **Default queue filter** | Command center **status** default **`""` (All)** so triage sees full queue first. |
| **Triage modal** | Loading vs error vs content; **backdrop click** closes; **stopPropagation** on dialog. |
| **Action guards** | **Acknowledge / Resolve / Save RCA** disabled when `status === RESOLVED` with tooltips. |
| **Empty states** | Org missing, no rows after filters, detail load error. |
| **SLA dashboard** | **`measuredValue` null** renders as **—** (not `"null"` string). |
| **Routes** | Deep links remain under `/owner/inventory/*` and `/owner/operations/command-center` (verified against `app/owner` tree). |

---

## Performance & data integrity

| Item | Notes |
|------|--------|
| **Indexes** | Composite **`(orgId, variantId, branchId, periodStart, periodEnd)`** on `cost_facts` for CTS drill-down (migration `20260404190000_wave4_cost_facts_detail_index`). Existing indexes on `cts_summaries`, `slo_measurements`, `operational_exception_indices` remain valid. |
| **Heavy queries** | Rollup loads GRN lines in window (bounded by data); exception reconcile caps **2000** rows per run; refresh loops use **take** limits on sources. |
| **Snapshot consistency** | Cost rollup deletes then recreates facts/CTS for exact `(orgId, periodStart, periodEnd)`; SLO measurements deleted then recreated for same window. **Use identical ISO window** on refresh + read APIs. |

---

## Testing / QA checklist

- [ ] **CTS**: Run refresh; spot-check `CostFact.inputsJson` vs `GrnLine`; confirm per-row `confidence` matches lines with `unitCost` in that SKU×branch bucket.
- [ ] **Org isolation**: Call APIs with another org’s `orgId` → 403; CTS detail with foreign `variantId`/`branchId` → null/404 behavior.
- [ ] **SLA**: Window with zero dispatches → `measuredValue` null; with dispatches → % matches manual count; discrepancy trace shows window vs all-pending.
- [ ] **Exceptions**: Resolve discrepancy in source → next refresh + reconcile → index **RESOLVED** with **RECONCILE** timeline.
- [ ] **Lifecycle**: Acknowledge → RESOLVED; RCA saves timeline **RCA** event.
- [ ] **UI**: Command center filters, modal guards, SLA **—** for null measurement.

---

## Apply steps

1. Deploy API; run migrations including **`20260404190000_wave4_cost_facts_detail_index`** (after Wave-4 base migration).
2. `npx prisma generate`
3. Re-run **`POST /api/v1/intelligence/financial/refresh`** (or `npm run job:wave4-rollup`) for a pilot org to backfill corrected CTS confidence and SLO traces.

---

**Status:** Hardening pass applied in codebase; this document is the concise audit trail.
