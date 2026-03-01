# Product Compliance (Phase 3)

## Overview

Product compliance checks run before admin approval. When checks fail, the admin can still approve by **overriding** compliance and optionally providing a note (audit trail).

## Check result shape

- **passed**: `boolean` — `true` only when all checks are PASS.
- **checks**: `{ key, name, status, message? }[]`
  - **status**: `"PASS"` | `"FAIL"` | `"INFO"`
  - **INFO**: Used when the product status is not in `[SUBMITTED, UNDER_REVIEW, CHANGES_REQUESTED]`; failing rules are reported as non-blocking info.

## Checks performed

| Key | Name | Description |
|-----|------|-------------|
| brand_name | Brand name | Required, non-empty |
| product_name | Product name | Required, non-empty |
| sku | SKU | Required, non-empty |
| factory | Factory | Recommended (factoryId set) |
| required_images | Required images (min 2) | At least 2 proofs |
| primary_image | Primary / at least one image | At least one proof has media |
| duplicate_sku | Unique SKU | No other product in same org with same SKU |

## Status gating

- If product status is **SUBMITTED**, **UNDER_REVIEW**, or **CHANGES_REQUESTED**: any failing check has status **FAIL** and blocks approval unless overridden.
- If product status is anything else (e.g. DRAFT, ACTIVE): failing checks are reported as **INFO** (non-blocking); approval is not blocked by compliance.

## Override policy

- When **compliance.passed === false** and the admin approves a **PRODUCT** approval, the request must include:
  - **overrideCompliance**: `true`
  - **overrideNote**: optional string (stored for audit)
- Backend responds **400 COMPLIANCE_FAILED** if approval is attempted without override when compliance failed.
- When override is used:
  - Audit **actionKey** is **COMPLIANCE_OVERRIDE** (not `admin.approval.approve`).
  - **overrideNote**, **overrideAt**, **overrideByUserId** are persisted on `ProducerApproval` (additive fields).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/admin/governance/compliance/product/:productId` | Run product compliance checks. Optional query: `producerOrgId` to scope (403 if product belongs to another org). |

Response envelope: `{ success, data: { passed, checks }, traceId }`.

## Approve with override

- **POST** `/api/v1/admin/approvals/:id/approve`
- Body when compliance failed: `{ overrideCompliance: true, overrideNote?: "optional note" }`
- Body when compliance passed: `{ note?: "optional" }` (no override needed).

## Touch points

- `src/api/v1/services/governance/compliance.service.ts` — `runProductComplianceChecks`
- `src/api/v1/modules/admin_governance/admin_governance.controller.ts` — `productCompliance` (GET)
- `src/api/v1/modules/admin_approvals/admin_approvals.controller.ts` — `approve` (compliance check + override)
- `src/api/v1/modules/producer/producerApproval.service.ts` — `approveApproval` (override payload persisted)
