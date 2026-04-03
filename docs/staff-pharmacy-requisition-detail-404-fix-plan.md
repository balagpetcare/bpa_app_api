# Staff pharmacy requisition detail — resolution notes

## Problem (historical)

Under some Next.js 16 + Turbopack setups, **`.../pharmacy/requisitions/[segment]`** detail URLs misbehaved while a **flat** `requisition-detail` segment worked when paired with redirects.

## Current architecture (superseded strategy)

Canonical implementation is documented in **`docs/pharmacy-requisition-routing-and-id-fix-plan.md`**.

- **Canonical URL:** `/staff/branch/:branchId/pharmacy/requisitions/:requisitionId`
- **App Router:** `app/staff/(larkon)/branch/[branchId]/pharmacy/requisitions/[requisitionId]/page.tsx`
- **Shared UI:** `pharmacy/_components/BranchPharmacyRequisitionDetail.tsx`
- **Legacy:** `.../pharmacy/requisition-detail/:requisitionId` → **redirect** to nested `.../requisitions/:requisitionId` (`next.config.js` + `proxy.ts`)

## Validation

- List **Open** uses `.../pharmacy/requisitions/${id}`.
- Direct URL loads the nested page; legacy `requisition-detail` redirects to nested.

## Status

**Superseded** — keep this file as a short pointer; full audit and API/dashboard notes live in **`pharmacy-requisition-routing-and-id-fix-plan.md`**.
