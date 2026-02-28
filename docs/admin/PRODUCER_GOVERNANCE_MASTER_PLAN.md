# PRODUCER GOVERNANCE MASTER PLAN (Admin Panel থেকে Producer Panel Control)

**Version:** v1.0  
**System:** BPA/WPA (Backend API: `/api/v1`, Multi-panel Next.js: Admin panel on port `3103`)  
**Goal:** Admin Panel থেকে Producer Panel-এর সব গুরুত্বপূর্ণ কার্যক্রম **Observe + Control + Audit + Enforce** করা

---

## 0) Context, Standards, and Non-Negotiables

এই ডক Cursor AI-কে সরাসরি দেওয়া যাবে যাতে সে inventory → plan → implementation করতে পারে কম ambiguity-তে।

Must follow:

- `docs/BPA_STANDARD.md`
- `docs/PROJECT_CONTEXT.md`

Hard guardrails:

- Backend enforcement mandatory (frontend-only guard invalid)
- Fixed ports unchanged: API `3000`, Admin Next.js `3103`
- No direct DB writes from controllers; service layer only
- Never overwrite/delete existing working code; merge/update style
- Every admin write action must generate auditable event
- Multi-tenant/country isolation must stay intact

---

## 1) উদ্দেশ্য (Why we need this)

Producer Panel-এ যেসব কাজ (Products, Batches, Printing, KYC, Staff, Approvals, Codes) হচ্ছে, সেগুলোকে:

1. **Observe** করা (কী চলছে, কোথায় সমস্যা, কে করেছে)
2. **Control** করা (limit/policy/suspension/approval rules)
3. **Enforce** করা (owner/staff ভুলে approve করতে না পারে)
4. **Audit** রাখা (ডাটা পরিবর্তন, action timeline, evidence)

এগুলো না থাকলে:

- Approval hierarchy ভেঙে যায়
- Fraud/abuse ধরা যায় না
- Scaling-এ ops chaos হয়
- UI/UX inconsistent থাকে

---

## 2) Scope (কোন কোন Producer কার্যক্রম Admin থেকে কন্ট্রোল হবে)

### 2.1 Observe (Read/Monitoring)

Admin panel থেকে দেখা যাবে:

- Producer Org list + status (Active/Suspended/KYC pending/Rejected)
- Producer Org profile (KYC, owner, created date, last activity)
- Staff list + role/status + invite history
- Product pipeline: Draft -> Submitted -> Approved -> Published
- Batch pipeline: Created -> Serial allocated -> Printed (`printedAt`/`printedBy`/`printCount`)
- Print jobs/errors
- Approval queue (সব pending approvals)
- Audit timeline (org-based + entity-based)
- Usage & limits (quota consumption)

### 2.2 Control (Write/Enforcement)

Admin panel থেকে করা যাবে:

- Org suspend/unsuspend
- Feature flags: printing disable, batch create disable, code export disable, etc.
- Quotas: batch/day, product/day, prints/day, uploads/day
- Force approval routing: Platform admin required actions
- Staff override: disable staff, force role reset
- KYC decision: approve/reject/request-more-info
- Emergency actions: rollback publish, revoke tokens (optional)

---

## 3) Roles & Permission Model (Standard)

### 3.1 Global/Admin roles

- `platform.superadmin`
- `platform.admin`
- `platform.moderator` (approvals + kyc)
- `platform.support` (read-only + limited actions)

### 3.2 Producer roles

- Producer Owner
- Producer Staff: Manager/Operator/Viewer (example)

### 3.3 Permission naming

- Admin side: `admin.producers.read`, `admin.producers.write`, `admin.approvals.manage`, `admin.kyc.manage`, `admin.audit.read`
- Producer side existing keys remain (`producer.*`)
- UI must show human-readable labels (no raw keys in primary display)

---

## 4) System Architecture (How it should be built)

### 4.1 Single Source of Truth: Policy Engine

Backend-এ `ApprovalPolicyService` থাকবে যেটা ঠিক করবে:

- কোন action কে approve করতে পারবে
- কোন action platform approval mandatory
- Preconditions (KYC status, org status, quota, flag states)

Example rule:

- `product.publish` -> requires platform admin approval
- `batch.create` -> allowed only if KYC approved + quota OK + org not suspended
- `print.batch` -> allowed only if printing enabled + quota OK + org not suspended

Policy check অবশ্যই backend-এ হবে (frontend-only guard accepted নয়)।

### 4.2 Admin Governance APIs (backend)

Admin module prefix: `/api/v1/admin/producers/*`

Core endpoints (minimum):

1. `GET /admin/producers`  
   filters: status, kycStatus, search, date range, pagination
2. `GET /admin/producers/:orgId`  
   includes summary + key metrics
3. `GET /admin/producers/:orgId/staff`
4. `POST /admin/producers/:orgId/suspend`
5. `POST /admin/producers/:orgId/unsuspend`
6. `GET /admin/producers/:orgId/flags`
7. `PUT /admin/producers/:orgId/flags`
8. `GET /admin/producers/:orgId/quotas`
9. `PUT /admin/producers/:orgId/quotas`
10. `GET /admin/producers/:orgId/audit`
11. `GET /admin/approvals` (pending queue)
12. `POST /admin/approvals/:id/approve`
13. `POST /admin/approvals/:id/reject`
14. `GET /admin/permissions` (human readable permissions registry)

Optional/phase-2 endpoints:

- `GET /admin/producers/:orgId/print-jobs`
- `POST /admin/producers/:orgId/actions/revoke-publish`
- `POST /admin/producers/:orgId/actions/revoke-tokens`

### 4.3 Data model (minimum tables)

Prisma schema level additions:

1. `AuditEvent`
2. `OrgFeatureFlag`
3. `OrgQuota`
4. Existing `ProducerApproval` retained, but enforced via policy engine

---

## 5) Admin Panel UI Spec (Professional standard)

### 5.1 Navigation

Admin sidebar:

- Producer Governance
  - Producers
  - Approvals
  - KYC
  - Audit (optional global)
  - Policies (optional)

### 5.2 Producers List Page

Table columns:

- Producer name
- KYC status badge
- Org status badge
- Owner
- Last activity time
- Flags summary (example: Printing OFF)
- Actions: View, Suspend

Must include:

- search, filter, pagination
- empty state + error state + loading skeleton

### 5.3 Producer Detail Page (Tabs)

Header summary card:

- org name, status, KYC, created date, last activity, risk (optional)

Tabs:

1. Overview
2. Staff
   - list staff, role/status
   - invite history + resend/disable (if admin allowed)
3. Approvals
   - org-specific pending approvals
4. Limits & Policies
   - feature flags toggle
   - quotas edit (with confirmation modal)
5. Audit Timeline
   - filter by entity type, action, date
   - metadata JSON readable drawer

### 5.4 Human-readable permissions UI

- grouped permission list (Batch, Product, KYC, Codes, Printing, Governance)
- show label + description; raw key optional muted text

---

## 6) Observability & Operations (Must-have)

### 6.1 Route probes

Maintain route-probe endpoint group (internal) to validate critical governance routes quickly.

### 6.2 Error standardization

Backend returns consistent errors:

- `code`
- `message`
- `details`
- `traceId`

### 6.3 Correlation ID

Every request gets `traceId` (middleware) এবং audit rows-এ persist করতে হবে।

---

## 7) Implementation Roadmap (Safe phases)

### Phase 0 — Inventory & Gap Analysis (No code changes)

- Document current producer features & endpoints
- Document current admin capabilities
- Identify missing APIs/UI pieces vs acceptance criteria

### Phase 1 — Core Governance Backend

- `AuditEvent` table + logging utility (`createAuditEvent()`)
- Admin producer list/detail endpoints
- Suspend/unsuspend
- Feature flags + quotas tables and endpoints (basic)
- `ApprovalPolicyService` (minimal enforcement)
- Uniform error envelope with `traceId`

### Phase 2 — Admin UI

- Producer list + detail tabs
- Approvals queue UI
- Audit timeline UI
- Human-readable permissions display

### Phase 3 — Hardening & Scale

- policy rules extended across producer actions
- dashboards/metrics
- advanced filters
- printing job logs + resilience

---

## 8) Acceptance Criteria (Done definition)

A feature is DONE when:

1. Admin can see Producer org list + detail
2. Admin can suspend org and backend enforces block on producer actions
3. Admin can toggle printing OFF and print endpoints respect it
4. Admin can set quotas and quota enforcement works
5. Policy engine blocks unauthorized approvals/publish
6. All governance actions create `AuditEvent`
7. Admin UI shows human-readable permissions and standard states (loading/empty/error)

---

## 9) Cursor AI Execution Pack (Use these prompts)

### Prompt A — Inventory report generate

```txt
Create a documentation-only inventory report for Producer Governance.

Input:
- docs/admin/PRODUCER_GOVERNANCE_MASTER_PLAN.md

Tasks:
1) Scan backend-api and bpa_web to list all producer module features already implemented (products, batches, printing, kyc, staff, approvals, codes).
2) List all admin-side endpoints and UI pages that currently control or observe producer functions.
3) For each feature include: route, permission, service file path, DB model(s).
4) Identify gaps needed to meet the Acceptance Criteria.

Output:
- backend-api/docs/admin/PRODUCER_GOVERNANCE_INVENTORY.md

Constraints:
- No code changes.
- Cite concrete file paths for every claim.
```

### Prompt B — Implement Phase 1 (Backend governance)

```txt
Implement Phase 1 from docs/admin/PRODUCER_GOVERNANCE_MASTER_PLAN.md in backend-api.

Must include:
- Prisma models: AuditEvent, OrgFeatureFlag, OrgQuota
- Middleware/util: createAuditEvent() with traceId
- Admin endpoints:
  GET /api/v1/admin/producers
  GET /api/v1/admin/producers/:orgId
  POST /api/v1/admin/producers/:orgId/suspend
  POST /api/v1/admin/producers/:orgId/unsuspend
  GET/PUT /api/v1/admin/producers/:orgId/flags
  GET/PUT /api/v1/admin/producers/:orgId/quotas
  GET /api/v1/admin/producers/:orgId/audit
- ApprovalPolicyService (minimal) and backend enforcement hooks for product/batch approval + publish.
- Consistent error format with code/message/details/traceId.
- Tests for policy engine + suspension + quota enforcement (core cases minimum).

Also update docs:
- backend-api/docs/admin/PHASE1_IMPLEMENTATION_NOTES.md

Constraints:
- Service-layer writes only (no controller direct DB write).
- Preserve backward compatibility with existing producer flows.
```

### Prompt C — Implement Phase 2 (Admin UI governance console)

```txt
Implement Phase 2 in bpa_web Admin panel based on docs/admin/PRODUCER_GOVERNANCE_MASTER_PLAN.md.

Requirements:
- Add sidebar nav: Producer Governance
- Producers list page with search/filter/pagination
- Producer detail page tabs:
  Overview, Staff, Approvals, Limits & Policies, Audit Timeline
- Standard UI states: loading skeleton, empty, error + retry
- Use existing API calls where available; if endpoint missing add TODO block referencing backend docs.

Output docs:
- bpa_web/docs/admin/PRODUCER_GOVERNANCE_UI.md

Constraints:
- Follow existing admin route conventions and WowDash components.
```

### Prompt D — Human-readable permission registry

```txt
Make permissions human-readable across backend + frontend.

Backend:
- Create a permissions registry with label/group/description for admin + producer permissions.
- Expose GET /api/v1/admin/permissions grouped.

Frontend:
- Update role/permission display screens to show group + label + description.
- Optionally show raw key in muted small text.

Doc:
- backend-api/docs/admin/PERMISSIONS_REGISTRY.md
```

---

## 10) Notes / Guardrails (BPA/WPA standards)

- Backend enforcement mandatory; UI guard is not enough
- Modular services recommended:
  - `ApprovalPolicyService`
  - `QuotaService`
  - `FeatureFlagService`
  - `AuditService`
- No direct DB writes from controllers; service layer only
- Every admin action must create `AuditEvent`
- Keep multi-tenant/country isolation intact

---

## 11) Appendix A — API Response Shape (DTO Standards)

All governance endpoints should return one of these envelopes.

### 11.1 Success envelope

```json
{
  "success": true,
  "code": "OK",
  "message": "Request successful",
  "traceId": "trc_01JZ...XYZ",
  "data": {}
}
```

### 11.2 Error envelope

```json
{
  "success": false,
  "code": "POLICY_BLOCKED",
  "message": "Printing is disabled for this producer organization",
  "details": {
    "orgId": 123,
    "action": "print.batch",
    "reason": "FLAG_DISABLED"
  },
  "traceId": "trc_01JZ...XYZ"
}
```

### 11.3 DTO examples by endpoint

#### GET `/api/v1/admin/producers`

```json
{
  "success": true,
  "code": "OK",
  "message": "Producer organizations fetched",
  "traceId": "trc_xxx",
  "data": {
    "items": [
      {
        "orgId": 101,
        "name": "ABC Feeds Ltd",
        "status": "ACTIVE",
        "kycStatus": "APPROVED",
        "owner": { "userId": 88, "name": "Owner Name", "email": "owner@example.com" },
        "lastActivityAt": "2026-02-27T15:12:00.000Z",
        "flagsSummary": ["producer.printing.enabled=false"]
      }
    ],
    "page": 1,
    "pageSize": 20,
    "total": 145
  }
}
```

#### GET `/api/v1/admin/producers/:orgId`

```json
{
  "success": true,
  "code": "OK",
  "message": "Producer organization detail fetched",
  "traceId": "trc_xxx",
  "data": {
    "orgId": 101,
    "name": "ABC Feeds Ltd",
    "status": "ACTIVE",
    "kycStatus": "APPROVED",
    "ownerUserId": 88,
    "createdAt": "2026-01-02T10:00:00.000Z",
    "lastActivityAt": "2026-02-27T15:12:00.000Z",
    "metrics": {
      "pendingApprovals": 4,
      "printsToday": 320,
      "batchCreatesToday": 12
    }
  }
}
```

#### PUT `/api/v1/admin/producers/:orgId/flags`

```json
{
  "flags": [
    { "key": "producer.printing.enabled", "enabled": false },
    { "key": "producer.codes.export.enabled", "enabled": true }
  ],
  "reason": "Fraud investigation freeze"
}
```

Response:

```json
{
  "success": true,
  "code": "UPDATED",
  "message": "Feature flags updated",
  "traceId": "trc_xxx",
  "data": {
    "orgId": 101,
    "updatedFlags": [
      { "key": "producer.printing.enabled", "enabled": false, "updatedAt": "2026-02-28T09:10:00.000Z" }
    ]
  }
}
```

#### PUT `/api/v1/admin/producers/:orgId/quotas`

```json
{
  "quotas": [
    { "key": "producer.batches.create.daily", "limit": 50, "resetPeriod": "DAILY" },
    { "key": "producer.print.daily", "limit": 2000, "resetPeriod": "DAILY" }
  ],
  "reason": "Operational policy update"
}
```

#### POST `/api/v1/admin/producers/:orgId/suspend`

```json
{
  "reason": "KYC discrepancy under review",
  "until": null
}
```

#### GET `/api/v1/admin/producers/:orgId/audit`

```json
{
  "success": true,
  "code": "OK",
  "message": "Audit timeline fetched",
  "traceId": "trc_xxx",
  "data": {
    "items": [
      {
        "id": 9001,
        "createdAt": "2026-02-28T08:00:00.000Z",
        "actorUserId": 12,
        "actorRole": "platform.admin",
        "actionKey": "admin.producer.flags.update",
        "entityType": "PRODUCER_ORG",
        "entityId": "101",
        "orgId": 101,
        "metadata": {
          "changed": { "producer.printing.enabled": false },
          "reason": "Fraud investigation freeze"
        },
        "traceId": "trc_xxx"
      }
    ]
  }
}
```

---

## 12) Appendix B — Exact Prisma Blocks (Ready to paste)

Use these exact blocks as baseline for Phase 1.

```prisma
enum OrgQuotaResetPeriod {
  DAILY
  MONTHLY
}

model AuditEvent {
  id              Int      @id @default(autoincrement())
  actorUserId     Int?
  actorRole       String   @db.VarChar(64) // platform.superadmin | platform.admin | owner | staff
  actionKey       String   @db.VarChar(128)
  entityType      String   @db.VarChar(64) // PRODUCER_ORG | PRODUCT | BATCH | APPROVAL | STAFF | KYC
  entityId        String?  @db.VarChar(128)
  orgId           Int?
  metadata        Json?
  traceId         String?  @db.VarChar(128)
  ip              String?  @db.VarChar(64)
  createdAt       DateTime @default(now())

  @@index([orgId, createdAt])
  @@index([entityType, entityId])
  @@index([actorUserId, createdAt])
  @@index([actionKey, createdAt])
  @@index([traceId])
  @@map("audit_events")
}

model OrgFeatureFlag {
  id              Int      @id @default(autoincrement())
  producerOrgId   Int
  key             String   @db.VarChar(128)
  enabled         Boolean  @default(true)
  updatedByUserId Int?
  updatedAt       DateTime @updatedAt
  createdAt       DateTime @default(now())

  producerOrg     ProducerOrg @relation(fields: [producerOrgId], references: [id], onDelete: Cascade)
  updatedBy       User?       @relation("OrgFeatureFlagUpdatedBy", fields: [updatedByUserId], references: [id], onDelete: SetNull)

  @@unique([producerOrgId, key], map: "org_feature_flags_org_key_unique")
  @@index([producerOrgId])
  @@index([key])
  @@map("org_feature_flags")
}

model OrgQuota {
  id              Int                 @id @default(autoincrement())
  producerOrgId   Int
  key             String              @db.VarChar(128)
  limit           Int
  used            Int                 @default(0)
  resetPeriod     OrgQuotaResetPeriod @default(DAILY)
  updatedByUserId Int?
  updatedAt       DateTime            @updatedAt
  createdAt       DateTime            @default(now())

  producerOrg     ProducerOrg @relation(fields: [producerOrgId], references: [id], onDelete: Cascade)
  updatedBy       User?       @relation("OrgQuotaUpdatedBy", fields: [updatedByUserId], references: [id], onDelete: SetNull)

  @@unique([producerOrgId, key], map: "org_quotas_org_key_unique")
  @@index([producerOrgId])
  @@index([key])
  @@index([resetPeriod])
  @@map("org_quotas")
}
```

Integration note:

- Existing `ProducerApproval` model stays unchanged structurally.
- Enforcement path should call `ApprovalPolicyService` before state transitions.

---

## 13) Appendix C — Admin UI Route List (Port + Path)

### 13.1 Runtime ports (reference)

- Backend API: `http://localhost:3000/api/v1`
- Admin panel dev: `http://localhost:3103`

### 13.2 Existing producer-related admin routes (already present)

- `/admin/verifications?tab=producer_orgs`
- `/admin/verifications/producer-orgs` (redirect pattern)
- `/admin/verifications/producer-orgs/[id]` (open specific item)

### 13.3 Proposed governance routes (Phase 2 canonical)

- `/admin/producer-governance`
- `/admin/producer-governance/producers`
- `/admin/producer-governance/producers/[orgId]`
- `/admin/producer-governance/approvals`
- `/admin/producer-governance/kyc`
- `/admin/producer-governance/audit`
- `/admin/producer-governance/policies`

Compatibility note:

- During rollout, keep links from verification-based producer views functional to avoid workflow break.

---

## 14) Appendix D — Suggested Feature Flags & Quotas (Starter)

Feature flags:

- `producer.printing.enabled`
- `producer.batches.enabled`
- `producer.products.enabled`
- `producer.codes.export.enabled`
- `producer.staff.invites.enabled`

Quotas:

- `producer.products.submit.daily`
- `producer.batches.create.daily`
- `producer.print.daily`
- `producer.uploads.daily`

---

## 15) Final Implementation Guard Checklist

Before merging any governance phase:

1. All targeted endpoints perform backend policy checks
2. Suspended org cannot execute restricted producer actions
3. `traceId` flows request -> error response -> audit row
4. Admin write endpoints generate `AuditEvent`
5. UI uses human-readable permission labels
6. Loading/empty/error states exist on new governance pages
7. Tests cover policy blocked + quota exceeded + suspended org paths

