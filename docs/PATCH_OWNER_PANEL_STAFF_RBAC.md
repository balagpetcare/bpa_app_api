# Owner Panel Staff RBAC (Fix 403 for Team Members)

## Problem
When a Team Member/Staff (not actual Owner) used the Owner panel at `/owner/products/1/edit`, multiple 403s occurred:
- `GET /api/v1/owner/staffs`, `GET /api/v1/owner/organizations`, `GET /api/v1/owner/branches`, `GET /api/v1/owner/requests?summary=1`, `GET /api/v1/owner/notifications`, and `PATCH /api/v1/products/1` all returned 403.

## Approach (Option A)
Keep `/owner/*` as “owner-panel context” and allow Staff/Team with RBAC:
- Owner routes accept OWNER, ADMIN, STAFF, TEAM (via `ownerPanelGuard`).
- List endpoints (organizations, branches, staffs, requests, notifications) return data scoped to the user’s **effective** org/branch set (owned, OrgMember, UserContext/team, OwnerDelegation).
- Product GET/PATCH use `getOrgIdForUser` that includes OwnerTeamMember and permissions from delegation/team scopes so staff with product scope can edit.

## Backend Changes

### New / updated files
| File | Change |
|------|--------|
| `src/api/v1/services/ownerPanelAccess.service.ts` | New. `getEffectiveOrgIdsForOwnerPanel(prisma, userId)`, `getEffectiveBranchIdsForOwnerPanel(prisma, userId)`. |
| `src/middlewares/ownerPanelGuard.ts` | New. Allows OWNER, ADMIN, STAFF, TEAM (replaces roleGuard for owner panel). |
| `src/api/v1/modules/owner/owner.routes.ts` | Use `ownerPanelGuard()` instead of `roleGuard(['OWNER','ADMIN'])` for post-onboarding routes. |
| `src/api/v1/modules/owner/owner.controller.ts` | Use `getEffectiveOrgIdsForOwnerPanel` / `getEffectiveBranchIdsForOwnerPanel` for listOrganizations, listOwnerBranchesAll, listStaffs, getOwnerRequestsInbox; getOrganization and getStaff allow access when org is in effective set. Local `getOwnerOrgIds` replaced by `getOwnerOrgIdsForRequest` calling the new helper. |
| `src/api/v1/modules/products/products.controller.ts` | `getOrgIdForUser` extended with OwnerTeamMember path (same as master-catalog). |
| `src/api/v1/modules/products/products.routes.ts` | `requireOwnerOrProductManage`: allow `role === 'OWNER'` and `product.update`; 403 response includes `debug: { required, role }`. |
| `src/middleware/auth.middleware.ts` | Merge `getPermissionsForOwnerPanel(userId)` into `req.user.permissions`; set `req.user.userType` from `req.user.role` if missing. |
| `src/api/v1/services/scopePermission.service.ts` | `getPermissionsForOwnerPanel`: include permissions from OwnerTeamMember team scopes. |
| `src/api/v1/modules/auth/auth.controller.ts` | `panels.owner` true when `hasTeamMember`; merge team/delegation permissions for auth/me. |
| `src/middlewares/requireOwnerScope.ts` | 403 response includes `detail`, `debug: { required, role }`. |

### Behaviour
- **Owners**: Unchanged; full access to their orgs/branches.
- **Staff/Team**: Can open Owner panel; lists (organizations, branches, staffs, requests) and notifications are scoped to effective org/branch set. Product edit: allowed if user has `product.update` / `owner.products.manage` (from delegation or team scopes) and product’s org is in their effective org (via OrgMember, OwnerTeamMember, or OwnerDelegation).

## Frontend Changes (bpa_web)

| File | Change |
|------|--------|
| `app/owner/products/[id]/edit/page.tsx` | On load and on submit: on 403 / ACCESS_DENIED show friendly message: “You don’t have permission to view or edit this product.” / “Ask your organization owner for product edit access.” |

No change to `useEntityCounts` or `NotificationBadge`: backend now returns 200 with scoped data for staff, so 403 spam is resolved without skipping calls.

## Verification

1. **Seed / ensure data**: One org, one owner, one staff in a team with product edit scope and branch access (OwnerTeamMember + OwnerDelegation with `products` scope, or OrgMember with branch access and product permissions).
2. **Staff flow**: Log in as staff → open `/owner/products/1/edit` (product in their org). No 403 on mount; GET product and PATCH product succeed.
3. **Owner flow**: Log in as owner → same pages and PATCH; full access, no regression.
4. **Forbidden**: Staff without product scope or for product outside their org gets 403 with clear message and optional `debug.role`.

## Minimal script

See `scripts/verify-staff-product-edit.md` for manual steps. Optional: run backend, then use browser or curl with staff cookie to hit `GET /api/v1/owner/branches`, `GET /api/v1/products/1`, `PATCH /api/v1/products/1` and assert 200 where access is allowed.
