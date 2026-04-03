# Injection Tokens — Enterprise UI Refactor Plan (Overview + Create)

**Document type:** Architecture + UX refactor plan (no implementation in this change).
**Date:** 2026-03-23.
**Governance:** Follow [WINDSURF_GLOBAL_RULE.md](./WINDSURF_GLOBAL_RULE.md) (plan-first, docs in `/docs` only).

**Related sources of truth (do not duplicate; extend mentally when implementing):**

- [CLINIC_INJECTION_TOKEN_IMPLEMENTATION_PLAN.md](./CLINIC_INJECTION_TOKEN_IMPLEMENTATION_PLAN.md) — API, billing, walk-in, medicine sources.
- [CLINIC_INJECTION_TOKEN_IMPLEMENTATION_REPORT.md](./CLINIC_INJECTION_TOKEN_IMPLEMENTATION_REPORT.md) — as-built behavior.
- Frontend today: `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/medicine-control-injection-tokens/page.tsx` (~2.3k lines, monolithic).
- Backend gate: `backend-api/src/api/v1/modules/clinic/injectionToken.service.ts` — **paid `Order` required** before token creation; `billingCheckout` optional path.

---

## 1. Problem statement

The staff Injection Tokens screen combines:

- Token list, KPIs, filters, pagination
- Patient / owner lookup, visit selection, walk-in flow
- Multi-line medicine editor, vial sessions, prescriptions, treatment courses
- Billing checkout toggles, service lines, payment method, `markPaid`
- Token validation UI, detail drawer, cancel flow

This violates separation of concerns, hurts usability, and blocks reuse (e.g. patient search elsewhere). The target is a **two-route enterprise pattern**: **Overview** (read + navigate) vs **Create** (single focused workflow).

---

## 2. Target information architecture (text diagram)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Staff → Branch → Clinic → Medicine Control → Injection Tokens          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
     ┌──────────────────────────┐     ┌──────────────────────────┐
     │  OVERVIEW (list + stats)  │     │  CREATE /new (workflow)   │
     │  • KPIs                   │     │  • Encounter              │
     │  • Table + filters        │     │  • Patient                │
     │  • Search token code      │     │  • Medicine lines         │
     │  • CTA → /new             │     │  • Charges                │
     │  • Row → detail drawer    │     │  • Summary (sticky)       │
     │  • Cancel (permissioned)  │     │  • Payment                │
     └─────────────┬────────────┘     │  • Generate (gated)       │
                   │                  └─────────────┬────────────┘
                   │                                │
                   └────────────┬───────────────────┘
                                ▼
              Same REST API: list, context, generate, cancel, validate
              (contracts unchanged; see §6)
```

**Data dependency (server rules, unchanged):**

```
Create payload ──► POST …/injection-token
                       │
                       ├─► visitId OR billingCheckout.walkIn (creates Visit)
                       ├─► medicationLines (normalized server-side)
                       ├─► billingCheckout? → Order + items; if total>0 then markPaid MUST be true
                       └─► Resolve linked Order with paymentStatus COMPLETED ──► Token row
```

---

## 3. Routes and Next.js filesystem reality

**Canonical URLs (already used in sidebar):**
`/staff/branch/:branchId/clinic/medicine-control/injection-tokens`

**Filesystem today:** The app uses a **flat segment** `medicine-control-injection-tokens` because nested `medicine-control/injection-tokens` can 404 under Turbopack; `bpa_web/next.config.js` rewrites the public URL to the flat folder.

**Implementation choice (plan):**

| Option | Overview path (file) | Create path (file) | Config |
|--------|----------------------|--------------------|--------|
| **A (recommended)** | Keep flat root: `medicine-control-injection-tokens/page.tsx` | `medicine-control-injection-tokens/new/page.tsx` | Add `beforeFiles` rewrite: `…/injection-tokens/new` → `…/medicine-control-injection-tokens/new` |
| B | Migrate to nested `medicine-control/injection-tokens/page.tsx` | `medicine-control/injection-tokens/new/page.tsx` | Adjust/remove rewrites; verify Turbopack |

**User-requested paths** in the task description map logically to **public** URLs; filesystem may stay flat under Option A while preserving the same browser path.

---

## 4. Page responsibilities

### 4.1 Overview page

**Public route:** `…/medicine-control/injection-tokens`
**Permissions:** Existing mix (`injection.token.list` + any of generate/validate for menu); page should gate **actions** by fine-grained perms.

**In scope:**

- KPI cards: **Pending**, **Used**, **Total** (total = server `total` for current filter set; document whether “Used” is global or “this page” — today it is **this list page**; consider a follow-up API aggregate endpoint for true branch-wide KPIs).
- Token table: columns aligned with today (code, status/lifecycle, patient/pet, visit, medicine summary, operator, dates).
- Filters: status, operator (`validatedByMe` / `generatedByMe`), date range, optional medicine source / encounter kind (already supported by `staffClinicInjectionTokensList`).
- Search: token code / quick filter field mapped to `tokenCode` query param.
- Row actions: open **detail drawer** (existing `staffClinicInjectionTokenWithContext`), **cancel** for `PENDING` if permitted.
- **CTA:** “Generate token” → navigate to `…/injection-tokens/new` (hide if no `injection.token.generate`).

**Out of scope (must not live here):**

- Patient lookup, visit picker, medicine line editor, billing checkout, generate submit.
- Heavy form state or `useEffect` chains tied to creation.

**Token validate UI:** Today co-located on the monolith. To honor “no form logic” on overview, either:

- Remove from overview and rely on **Injection Room** / ops screens, or
- Add a **third** lightweight route `…/injection-tokens/validate` (optional future), or
- A minimal **modal** triggered by a link (still “form”; prefer separate route if strict).

**Recommendation:** Move **validate** to Injection Room or a tiny dedicated route; keep overview read-centric.

---

### 4.2 Create page (`/new`)

**Public route:** `…/medicine-control/injection-tokens/new`
**Permission:** `injection.token.generate` (403-style empty state if missing).

**Sections (user-specified structure):**

| Block | Responsibility |
|-------|----------------|
| **A. Encounter** | Toggle: internal visit vs walk-in (`INTERNAL_VISIT` / `EXTERNAL_WALK_IN`). Internal: visit search + select (reuse `staffClinicVisitsList` / `staffClinicVisitGet`). Walk-in: optional attending doctor (`doctorBranchMemberId`); visit created via `billingCheckout.walkIn` on generate. |
| **B. Patient** | Search by phone/email (`staffClinicOwnerLookup` + pets), pet numeric ID (`staffClinicPatientGet`), name search (`staffClinicPatientsList`). **Create new patient:** deep-link to existing staff patient register flow or modal embedding the same API as register (reuse branch patterns). |
| **C. Medicine** | Table of lines; columns: Medicine (variant or manual name), Source (clinic stock / patient-brought — map to `INTERNAL_CLINIC` / `CLINIC_PROVIDED_MEDICINE` / `OUTSIDE_PRESCRIPTION_PATIENT_BROUGHT`), Route, Dose, Unit, Price (clinic lines). Add row; advanced fields in **collapse** (duration, frequency, longevity, line notes, vial session, manufacturer, batch, etc.). |
| **D. Charges** | Injection administration fee (service + price), consumables (service + price), optional consultation linkage if productized as a service line (today: `injectionServiceId` + `servicePrice`, `consumablesServiceId` + `consumablesPrice` inside `billingCheckout`). |
| **E. Summary (sticky right)** | Medicine subtotal (from line prices), fees subtotal, grand total; mirror server rules for checkout total. |
| **F. Payment** | `paymentMethod`, `markPaid` — must satisfy backend: **if order total > 0, `markPaid` required true** (see `injectionToken.service.ts`). |
| **G. Generate** | Single primary button; **disabled** until validation passes (see §5). |

**Preserve existing advanced integrations on create page only:**

- Prescription pick (`staffClinicPrescriptionsByVisit`), treatment course / day (`staffClinicTreatmentCoursesList`, `staffClinicTreatmentCourseSchedule`).
- External Rx fields: prescriber, clinic, notes, evidence upload (`uploadMedia` → `externalRxEvidenceUrl`).
- Expiry hours, `billingCheckoutEnabled` vs implicit walk-in checkout (today walk-in still sends minimal `billingCheckout` with `markPaid: true` even when billing UI off — behavior must be preserved or explicitly redesigned with backend sign-off).

---

## 5. Data and logic requirements

### 5.1 Payment before issue (non-negotiable)

Backend requires a **completed** order linked to the visit before inserting the token:

- Either **`billingCheckout`** in the same `POST …/injection-token` request (creates order + items + payment), or
- An **existing** `Order` on that visit with `paymentStatus: COMPLETED` (legacy “bill elsewhere” path).

**UI implications:**

- Create page must make the payment rule **visible**: user cannot enable Generate until the app knows the request will satisfy the server (either explicit checkout with `markPaid` when total > 0, or detected existing paid order — if the latter is surfaced, needs **API read** of visit billing state; today the monolith does not fully automate “detect paid order” in the UI).

### 5.2 Walk-in vs internal visit

- **Walk-in:** `billingCheckout.walkIn` creates visit; server sets encounter kind to `EXTERNAL_WALK_IN` when walk-in checkout is used.
- **Internal:** `visitId` required on payload; link token to that visit.

### 5.3 Medicine sources

- **Clinic stock / clinic-provided:** `variantId` required; vial session optional; billing line via `medicineLineBillings` when prices > 0; inventory still tied to dose recording, not checkout.
- **Patient-brought:** manual medicine fields; **no** variant billing line; notes merged into `externalRxNotes` pattern as today; price optional / zero.

### 5.4 Catalog auto-fill (route, unit, price)

**Gap:** Current UI defaults route/unit manually and does **not** auto-fill price on variant change (user types “Clinic med price”). Target UX requires **auto-fill from catalog**.

**Plan:**

1. **Inventory existing APIs:** `staffClinicMedicinePoliciesList` response shape — check for `variant`, default unit, route, branch price.
2. If insufficient, **backend extension (separate ticket):** enrich policy payload or add `GET …/variant/:id/injection-defaults` returning `{ route, unit, unitPrice, productName }` from branch catalog / pricing services.
3. Frontend: on variant select, set draft fields; user can override (editable columns).

---

## 6. API usage (no contract breaks)

Reuse `bpa_web/lib/api.ts` helpers (signatures already aligned):

| Concern | Function |
|---------|----------|
| List + filters | `staffClinicInjectionTokensList` |
| Generate | `staffClinicGenerateInjectionToken` |
| Context / drawer | `staffClinicInjectionTokenWithContext` |
| Cancel | `staffClinicCancelInjectionToken` |
| Validate (if kept) | `staffClinicValidateInjectionToken` |
| Policies / catalog | `staffClinicMedicinePoliciesList` |
| Visits | `staffClinicVisitsList`, `staffClinicVisitGet` |
| Vials | `staffClinicVialSessionsList` |
| Branch services / doctors | `staffClinicServices`, `staffClinicDoctors` |
| Patients / owner | `staffClinicPatientsList`, `staffClinicPatientGet`, `staffClinicOwnerLookup` |

**Backward compatibility:**

- Do not rename query params or body fields.
- Keep sending `medicationLines`, `encounterKind`, `billingCheckout`, optional `prescriptionId`, `treatmentCourseId`, `treatmentDayId`, charge snapshots as today.
- Legacy single `variantId` + `expectedDose` path remains server-supported but **Create UI** should prefer multi-line only.

---

## 7. Reusable components (proposed)

Place under a dedicated folder to avoid sprawl, e.g.
`bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/_components/injection-tokens/`
(or `src/components/clinic/injection-tokens/` if shared across staff routes).

| Component | Role |
|-----------|------|
| **PatientSearch** | Phone/email owner lookup, pet ID load, name search; emits `SelectedPetContext` (extract existing mappers from monolith). |
| **VisitSelector** | Search visits (`staffClinicVisitsList` with `search`), list for pet, optional manual visit ID verify; emits `visitSummary`. |
| **MedicineLineTable** | Renders rows, source switching, variant picker filtered by policy list, vial dropdown per variant, collapsed advanced fields. |
| **PricingSummary** | Subtotals + grand total from draft lines + fee fields; read-only display for sticky panel. |
| **PaymentPanel** | `paymentMethod`, `markPaid`, disabled states when total > 0 and not paid. |
| **EncounterTypeToggle** | Internal vs walk-in copy + hints (existing `ENCOUNTER_FLOW_OPTIONS`). |
| **ExternalRxPanel** | Prescriber, clinic, notes, file upload (reuse `uploadMedia`). |
| **TokenDetailDrawer** | Lift existing drawer content from monolith for overview row click. |

**Hooks (proposed):**

| Hook | Responsibility |
|------|----------------|
| `useInjectionTokenList(branchId, queryState)` | Fetch list, pagination, filter debouncing. |
| `useMedicationLineDrafts()` | CRUD lines, vial session fetching keyed by variant set (reuse `vialFetchKey` pattern). |
| `useInjectionTokenGenerate(branchId)` | Build payload, call `staffClinicGenerateInjectionToken`, toast + redirect to overview with new code highlighted (optional). |
| `useBranchInjectionCatalog(branchId)` | Load policies + (future) price/route defaults. |

---

## 8. UI structure (Create page layout)

Wireframe (desktop):

```
┌────────────────────────────────────────────────┬─────────────────┐
│ PageHeader [Back to list]                       │                 │
├────────────────────────────────────────────────┤  PricingSummary  │
│ A. Encounter (cards or stepper)                 │  (sticky)        │
├────────────────────────────────────────────────┤                 │
│ B. PatientSearch + selected chip                │                 │
├────────────────────────────────────────────────┤                 │
│ C. MedicineLineTable + Add medicine             │                 │
├────────────────────────────────────────────────┤                 │
│ D. Charges (injection fee, consumables)       │                 │
├────────────────────────────────────────────────┤                 │
│ E. External Rx (collapsible if internal only) │                 │
├────────────────────────────────────────────────┤                 │
│ F. PaymentPanel                                 │                 │
├────────────────────────────────────────────────┤                 │
│ G. Generate Token (primary)                     │                 │
└────────────────────────────────────────────────┴─────────────────┘
```

Follow existing WowDash / Larkon patterns (`PageHeader`, `StatCard`, `SectionCard`, form controls) — **no visual redesign beyond layout split** unless a separate design ticket exists.

---

## 9. Migration plan (safe, incremental)

**Phase 0 — Spike (1–2 days)**

- Confirm Next route strategy (§3) and add rewrite for `/new` if using flat folder.
- Confirm catalog auto-fill data source; open backend ticket if needed.

**Phase 1 — Extract without behavior change**

- Create component files; move JSX from monolith into **presentational** pieces with props.
- Overview page: strip generation form; leave list + drawer + cancel.
- Create page: mount extracted form; **same** `handleGenerate` logic moved into hook.
- Run manual regression: internal visit, walk-in, multi-line, billing on/off, outside-only lines.

**Phase 2 — Overview hardening**

- Ensure KPIs and filters match product intent; optional server aggregate for KPIs.
- Remove validate from overview or relocate per §4.1.

**Phase 3 — UX polish**

- Sticky summary, step validation messages, disable Generate with explicit reasons.
- Success path: redirect to overview + toast + optional query `?highlight=TOKEN`.

**Phase 4 — Cleanup**

- Delete dead code from old monolith file.
- Update `branchSidebarConfig` only if URLs change (should not).
- Document in [CLINIC_INJECTION_TOKEN_IMPLEMENTATION_REPORT.md](./CLINIC_INJECTION_TOKEN_IMPLEMENTATION_REPORT.md) when implemented.

**Testing checklist (manual):**

- Generate with `billingCheckout` and `markPaid` true, total > 0.
- Generate walk-in with zero total (order still created; payment COMPLETED when total 0).
- Failure: total > 0 and `markPaid` false → expect server error; UI should pre-validate.
- Patient-brought-only lines: no `medicineLineBillings` for outside.
- Cancel pending token from overview.

---

## 10. Risks and open decisions

| Risk | Mitigation |
|------|------------|
| Nested route 404 under Turbopack | Use flat folder + explicit rewrite for `/new`. |
| “Paid order exists” path invisible in UI | Add visit billing summary API or keep billing checkout mandatory on Create until API exists. |
| Catalog lacks route/unit/price | Backend enrichment before promising auto-fill in UI. |
| Permission drift between pages | Mirror `canGenerate` / `canCancel` / `canValidate` gates on both routes. |

---

## 11. Step-by-step implementation order (for developers)

1. Add filesystem route for **Create** (`new/page.tsx`) and **Next rewrite** if needed.
2. Move **list + drawer + cancel + load** to **Overview** `page.tsx` (trimmed).
3. Extract **TokenDetailDrawer** and **list filter bar** as components.
4. Implement **Create** shell layout with sticky **PricingSummary**.
5. Extract **PatientSearch**, **VisitSelector**, wire to existing APIs.
6. Extract **MedicineLineTable** + **vial** loading effect.
7. Extract **PaymentPanel** + **Charges**; preserve `billingCheckout` object shape.
8. Move **generate** handler to `useInjectionTokenGenerate`; unify validation rules.
9. Implement catalog **auto-fill** (or interim: auto-fill unit/route defaults only).
10. Relocate **validate** UI per product decision.
11. Regression pass + update enterprise docs when shipped.

---

**Output file:** `D:/BPA_Data/backend-api/docs/injection-token-refactor-plan.md` (this document).
