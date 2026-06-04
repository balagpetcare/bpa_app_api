# VaccineType to Inventory Mapping Plan

## 1. Goal
Replace temporary name-based vaccine stock matching with explicit, durable mapping between vaccination-facing `VaccineType` records and inventory-facing `ClinicalItem` / `ClinicalItemVariant` records.

The desired end state is:
- vaccination administration resolves stock candidates from a stored mapping first
- mapping is safe for multi-tenant BPA/WPA orgs
- admins/owners can review and manage mappings intentionally
- the system can gradually migrate away from heuristic name/slug matching without breaking active clinics

## 2. Current Problem
`VaccineType` and `ClinicalItem` are currently separate domains with no explicit relational bridge.

### Current `VaccineType` shape
In `prisma/schema.prisma`, `VaccineType` currently contains only:
- `id`
- `name`
- `targetAnimalTypeId`
- `defaultIntervalDays`
- `description`

It is effectively a vaccination master/type table, not an inventory table.

### Current inventory shape
`ClinicalItem` is org-scoped and represents the inventory/catalog item:
- `orgId`
- `itemCode`
- `name`
- `slug`
- `domainType`
- `categoryId`
- `isInventoryTracked`
- `requiresBatch`
- `requiresExpiry`
- `manufacturerName`
- `masterCatalogItemId`

`ClinicalItemVariant` is item-scoped and represents the sellable/stockable variant:
- `itemId`
- `variantName`
- `sku`
- `barcode`
- `unitLabel`
- `packSize`
- `strengthOrSpec`

### Why this is a problem today
- `VaccineType` is effectively shared/global
- `ClinicalItem` is tenant/org-specific
- there is no formal mapping between them
- vaccination stock selection therefore falls back to inferred matching based on item names, slugs, and a few vaccine-like keywords

### Current temporary matching logic
`src/api/v1/modules/clinic/vaccination.service.ts` currently uses `getBranchVaccineStockCandidates()` with heuristic matching:
- `exact-name`
- `exact-variant-name`
- `slug`
- `restricted-contains`

It also uses:
- vaccine terms like `vaccine`, `rabies`, `dhpp`, `dhlpp`, `fvr`, `feline`
- category name contains `vaccin`
- inventory item code starting with `VAC`

This produces statuses:
- `MATCHED`
- `AMBIGUOUS`
- `UNMAPPED`

That logic is useful as a fallback and migration aid, but it is not a safe long-term source of truth.

## 3. Mapping Design Options

### A. Add `clinicalItemId` / `clinicalItemVariantId` nullable fields to `VaccineType`
This means each `VaccineType` directly points to one inventory item and optional variant.

#### Pros
- simple reads
- easy to reason about in vaccination service
- easy to show in admin UI

#### Cons
- unsafe for multi-tenant design because `VaccineType` is global/simple while `ClinicalItem` is org-scoped
- one org’s inventory item cannot safely be stored directly on a shared vaccine type used by other orgs
- does not support org-specific substitutions or different brands/variants across clinics
- would force one global mapping for what is actually a tenant-specific inventory choice

#### Verdict
Not recommended for BPA/WPA multi-tenant inventory.

### B. Create `VaccineInventoryMapping` table
This means mapping rows are separate from `VaccineType`, typically linking:
- `vaccineTypeId`
- `clinicalItemId`
- optional `clinicalItemVariantId`
- scope metadata

#### Pros
- clean separation of domains
- supports future metadata such as mapping source, confidence, activation, audit notes
- easier to evolve than hard fields on `VaccineType`
- allows multiple mappings if business rules later need them

#### Cons
- needs one more join
- requires explicit uniqueness and validation rules
- still needs correct scope choice to avoid tenant leakage

#### Verdict
Strong foundation, but must be scoped correctly.

### C. Org/branch-specific mapping table
This means a dedicated mapping table, but scoped by tenant context, such as:
- `orgId`
- maybe `branchId`
- `vaccineTypeId`
- `clinicalItemId`
- optional `clinicalItemVariantId`

#### Pros
- matches actual data ownership: `ClinicalItem` belongs to an org
- allows one org to map Rabies Vaccine to a different inventory item than another org
- safe for multi-tenant BPA/WPA deployment
- allows phased evolution to branch overrides later if needed

#### Cons
- more complexity than global fields
- branch-level scope can become noisy if overused too early
- validation must enforce that mapped item belongs to the same org and is inventory-eligible

#### Verdict
Best design direction, but prefer org-level first and branch-level only as an optional later override.

## 4. Recommended Approach
Choose a dedicated org-scoped mapping model: `VaccineInventoryMapping` keyed by `orgId + vaccineTypeId`, with optional `clinicalItemVariantId`, and no branch-level required mapping in the first version.

### Recommended model
Use an org-scoped mapping table, conceptually:
- `id`
- `orgId`
- `vaccineTypeId`
- `clinicalItemId`
- `clinicalItemVariantId` nullable
- `isActive`
- `mappingSource` such as `MANUAL`, `SEEDED`, `BACKFILLED`
- audit fields

Recommended uniqueness:
- unique on `(orgId, vaccineTypeId)`

### Why this is the safest approach
- `ClinicalItem` is org-owned, so mapping must also be org-owned
- a single `VaccineType` like “Rabies Vaccine” can legitimately point to different brands/items in different orgs
- current stock deduction already works with actual branch batches and variants; it does not need a branch-specific mapping row to function
- branch stock queries can still use the org mapping and then filter available batches within the chosen branch

### Why not branch-specific first
Branch-specific mapping is only necessary if different branches inside the same org intentionally map the same vaccine type to different inventory items.

That is possible, but it is a second-order problem. Starting with branch scope would:
- add extra UI and validation complexity
- increase mapping maintenance burden
- create avoidable ambiguity for owners/admins

Recommended Phase 1 rule:
- one org-level mapping per vaccine type
- branch stock selection uses that mapped item/variant, then branch-specific stock availability decides which batch can be used

Recommended Phase 2 capability:
- optional branch override table only if real business need appears

## 5. Backend API Plan
Add mapping APIs in the clinic catalog / vaccination admin area, with strict validation.

### GET mappings
Purpose:
- list current org-level mappings for an org/branch context
- show mapped item, variant, and validation status

Recommended routes:
- owner/staff branch context:
  - `GET /api/v1/clinic/branches/:branchId/vaccine-inventory-mappings`
- admin/governance context if needed later:
  - `GET /api/v1/admin/clinical-catalog/vaccine-inventory-mappings?orgId=...`

Response should include:
- `vaccineTypeId`, `vaccineTypeName`
- mapped `clinicalItemId`, `clinicalItemName`, `itemCode`
- mapped `clinicalItemVariantId`, `variantName`, `sku`
- category/domain/inventory flags
- mapping status such as `MAPPED`, `INVALID_ITEM`, `MISSING_VARIANT`, `INACTIVE`

### POST/PUT mapping
Purpose:
- create or update one org-level mapping

Recommended route:
- `POST /api/v1/clinic/branches/:branchId/vaccine-inventory-mappings`
- or idempotent:
  - `PUT /api/v1/clinic/branches/:branchId/vaccine-inventory-mappings/:vaccineTypeId`

Payload:
- `vaccineTypeId`
- `clinicalItemId`
- `clinicalItemVariantId` optional

### Validation rules
Validate that the chosen item:
- belongs to the same org as the branch
- is active
- has `domainType = MEDICINE`
- has `isInventoryTracked = true`
- is vaccine-like enough for Phase 1 safety

Recommended vaccine-like validation:
- category linked to seeded `vaccines` master category when available, or
- item code prefix like `VAC`, or
- explicit admin override flag later if nonstandard naming exists

Variant validation:
- if `clinicalItemVariantId` is provided, it must belong to `clinicalItemId`
- if item has only one active variant, frontend can auto-suggest it
- if item has zero variants, mapping can still be item-level and stock candidate selection can use batch rows for the item

### Runtime read behavior
Update future stock-candidate resolution logic to:
1. look up explicit mapping for `(orgId, vaccineTypeId)`
2. if found, restrict candidates to mapped item and optional variant
3. if not found, fall back to current heuristic matching during transition

## 6. Frontend Plan
Add a vaccine mapping management screen focused on explicit owner/admin setup.

### Owner/Admin vaccine mapping page
Main relationship:
- `Vaccine Type -> Clinical Item -> Variant`

Recommended UX:
- left column: vaccine types
- middle column: candidate clinical items
- right column: optional variants
- badges for inventory-tracked, batch-required, cold-chain, active/inactive
- mapping status chips:
  - `Mapped`
  - `Unmapped`
  - `Invalid`
  - `Fallback in use`

### Best placement
Owner side is the most natural first home because:
- owner clinic catalog already manages branch/org catalog content
- owner already has catalog tabs like items, categories, templates, import, linkages
- this is operational configuration rather than patient/staff workflow

Recommended owner placement:
- add a “Vaccine Mapping” or “Vaccine Linkages” tab/page under:
  - `app/owner/(larkon)/clinic/[branchId]/catalog/`

Admin side can be added later for governance/debugging:
- admin clinical catalog page already supports org item browsing and audit lookup
- useful for support teams and governance, but not the best primary editing surface

### Existing pages relevant to this plan
- owner clinic catalog page already has a placeholder `linkages` concept
- admin clinical catalog page already lists items by org and audit logs
- staff vaccination page currently consumes stock-candidate API results and surfaces `MATCHED`, `AMBIGUOUS`, `UNMAPPED`

### Staff UI effect
Once mapping exists, staff vaccination page should:
- show mapped item/variant confidence implicitly through cleaner candidate results
- stop surfacing most ambiguous name-based candidate states
- later show a simple note like “Mapped by catalog” instead of heuristic match strategies

## 7. Migration/Backfill
Do not remove name-based matching immediately. Use it as a controlled transition tool.

### Backfill strategy
1. Add mapping model and APIs.
2. Build a backfill helper that proposes mappings from existing heuristic matches.
3. Auto-accept only high-confidence cases.
4. Leave ambiguous cases for manual review.

### Safe auto-backfill candidates
Auto-backfill only when:
- the heuristic result is `MATCHED`
- there is exactly one distinct item candidate
- the item is active, inventory-tracked, `MEDICINE`, and vaccine-like

### Cases that should remain manual
- `AMBIGUOUS`
- multiple brands/items matching one vaccine type
- item maps only through weak text similarity
- org has no seeded vaccine item installed yet

### Runtime transition
Phase C behavior should be:
- mapping first
- fallback to name matching only when no active mapping exists
- log or surface when fallback is used

### Final removal plan
Only remove fallback after:
- mappings exist for nearly all active org vaccine types
- manual exceptions are resolved
- stock administration flows are verified against real tenant data

## 8. Risks
- wrong explicit mapping could deduct stock from the wrong vaccine item
- orgs may stock different brands or presentations for the same vaccine type
- branch-specific operational differences may emerge later even if org-level mapping is enough today
- legacy orgs may not have seeded vaccine catalog items installed, leaving mappings incomplete
- forcing variant mapping too early may create friction where clinics only track item-level stock logically
- a global mapping design would create multi-org conflicts because `ClinicalItem` is org-scoped
- removing fallback too early could block vaccination administration in partially configured clinics

## 9. Implementation Phases
### Phase A: schema + API
- add dedicated org-scoped vaccine inventory mapping model
- add list and create/update APIs
- validate mapped item and variant ownership plus inventory/vaccine eligibility

### Phase B: admin UI
- add owner-facing vaccine mapping page or catalog tab
- optionally add admin governance read/debug view
- support explicit mapping review and save

### Phase C: stock candidate uses mapping first, fallback to name matching
- update stock-candidate resolution to prefer explicit mapping
- keep heuristic fallback for unmapped orgs
- surface fallback status for debugging

### Phase D: remove fallback later
- measure mapping coverage
- clean up old heuristic branches only after tenant rollout is stable

## 10. Exact Next Implementation Command
Implement Phase A-C only: add an org-scoped `VaccineInventoryMapping` model and clinic APIs for listing/upserting vaccine-to-clinical-item mappings, build an owner/admin vaccine mapping UI for `Vaccine Type -> Clinical Item -> Variant`, and update vaccination stock-candidate resolution to use explicit mapping first with temporary fallback to current name-based matching.

## Recommendation Summary
- Recommended mapping model: dedicated org-scoped `VaccineInventoryMapping` table keyed by `orgId + vaccineTypeId`, pointing to `clinicalItemId` and optional `clinicalItemVariantId`
- Migration risk: medium, mainly from incorrect backfill or premature fallback removal; safest rollout is mapping-first with heuristic fallback retained during transition
- Next implementation command: `Implement Phase A-C only: add an org-scoped VaccineInventoryMapping model and clinic APIs for listing/upserting vaccine-to-clinical-item mappings, build an owner/admin vaccine mapping UI for Vaccine Type -> Clinical Item -> Variant, and update vaccination stock-candidate resolution to use explicit mapping first with temporary fallback to current name-based matching.`
