# Global-Ready Phase 2 – Donation + Compliance (Apply Steps)

**Reference:** [GLOBAL_READY_FULL_PLANNING.md](./GLOBAL_READY_FULL_PLANNING.md), Phase 1 must be applied first.

## Touch points (Phase 2)

| Item | Location |
|------|----------|
| Response helpers | `src/api/v1/utils/policyResponses.ts` |
| Feature gate | `src/api/v1/middlewares/requireFeature.ts` |
| Schema: TransactionStatus, AuditEntityType, AuditActorRole, Donation | `prisma/schema.prisma` |
| Migration | `prisma/migrations/20260129100000_phase2_donation_compliance/migration.sql` |
| Donate: policy check, idempotency, audit | `src/api/v1/modules/fundraising/fundraising.service.ts` |
| Donate controller/routes | `fundraising.controller.ts`, `fundraising.routes.ts` |
| Rate limiter | `src/middleware/rateLimiters.ts` (donationLimiter) |

## Apply steps

1. **Migration**
   `npx prisma migrate deploy` (or run the Phase 2 migration SQL).

2. **Generate client**
   `npx prisma generate`

3. **Runtime**
   - Donate route: `donationLimiter` → `auth` → `requireFeature('DONATION')` → `ctrl.donate`.
   - Policy OFF for country → 403 `POLICY_DENIED`, `reason_code: FEATURE_DISABLED`.
   - Donation limits exceeded → 403 `POLICY_DENIED`, `reason_code: LIMIT_EXCEEDED`, `details: { limit, value }`.
   - Optional header: `Idempotency-Key` – same key returns same donation response.
   - Each donation: `policyVersion` stored; audit log `DONATION_CREATED` (entityType DONATION).

## Env (optional)

- `RL_DONATION_WINDOW_MS` – window for donation rate limit (default 60000).
- `RL_DONATION_MAX` – max donate requests per window (default 30).

## Phase 2.6: Admin donation review (complete)

- **GET /api/v1/fundraising/admin/donations/hold** – list donations with status `ON_HOLD_REVIEW` or `KYC_REQUIRED`. Query: `?status=ON_HOLD_REVIEW`, `?limit=50`, `?cursor=<id>`.
- **PATCH /api/v1/fundraising/admin/donations/:id/status** – body `{ status: 'SUCCESS' | 'FAILED', note?: string }`. Only donations in `ON_HOLD_REVIEW` or `KYC_REQUIRED` can be updated. On `SUCCESS`: wallet credit + campaign stats + donor points (idempotent). Audit: `DONATION_STATUS_UPDATE`.

## Checkpoint

- Call `POST /api/v1/fundraising/campaigns/:id/donate` without `X-Country-Code` or with `X-Country-Code: BD` → 200 and donation created (BD policy has DONATION enabled).
- Call with `X-Country-Code: IN` (if IN has no ACTIVE policy or DONATION off) → 403 `POLICY_DENIED`, `reason_code: FEATURE_DISABLED` or `NO_POLICY`.
- Send same `Idempotency-Key` twice → same response body and no duplicate donation.
- Admin: `GET .../admin/donations/hold` → list hold/KYC donations; `PATCH .../admin/donations/:id/status` with `SUCCESS`/`FAILED` → status + audit + (on SUCCESS) wallet/stats/points.
