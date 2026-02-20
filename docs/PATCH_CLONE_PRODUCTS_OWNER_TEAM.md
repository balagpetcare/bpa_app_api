# Patch: Owner Team Clone Products Authorization

## Root cause

Owner Team users (delegates) were not recognized as organization members. The clone endpoint used `getOrgIdForUser(userId)`, which only considered:

1. **OrgMember** (ACTIVE)  
2. **Organization.ownerUserId** (direct owner)

Owner Team members exist only in **OwnerTeamMember** and were never added to **org_members**, so `getOrgIdForUser` returned `null` and the API responded with 403: "You must be a member or owner of an organization to clone products".

## Summary of changes

### Backend (bpa_app_api)

| File | Change |
|------|--------|
| `src/api/v1/modules/products/master-catalog.controller.ts` | Extended `getOrgIdForUser` to resolve org via **OwnerTeamMember** → team's owner → that owner's organization. Added `userHasAccessToOrg(userId, orgId)` that treats owner, OrgMember, and OwnerTeamMember as having access. Clone handler: accept `x-org-id` header and `body.orgId`; resolve org as `requested ?? getOrgIdForUser`; if no resolved org return **400** "Organization context missing"; then check access with `userHasAccessToOrg` (403 if no access). |
| `src/api/v1/services/ownerDelegation.service.js` | In `addTeamMember`, after upserting **OwnerTeamMember**, auto-upsert **OrgMember** for each organization owned by the team owner (role `BRANCH_STAFF`, status `ACTIVE`) so team members are org members. |
| `src/api/v1/services/teamInvitation.service.js` | On accept invitation, after adding **OwnerTeamMember**, auto-upsert **OrgMember** for each of the owner's organizations (same as above). Reused `ownerOrgs` for `orgIds` to avoid duplicate query. |
| `scripts/verify-clone-auth.ts` | New script: runs `getOrgIdForUser` and `userHasAccessToOrg` for (a) org owner, (b) Owner Team member, (c) user with no org; logs PASS/FAIL. Run: `npm run verify:clone-auth`. |
| `package.json` | Added script `verify:clone-auth`. |

### Frontend (bpa_web)

| File | Change |
|------|--------|
| `src/lib/apiFetch.js` | Added `getWorkspaceHeaders()`: when in browser, reads `bpa_org_id` and `bpa_branch_id` from `localStorage` and adds **X-Org-Id** and **X-Branch-Id** to every request. |
| `app/owner/products/master-catalog/page.tsx` | Use `useMe` and `getOrgIdFromMe(me)` (from `me.orgMembers` or `localStorage`). In `handleClone`, send `body: JSON.stringify(orgId != null ? { orgId } : {})` so clone request includes org context when available. |

## Authorization order on clone endpoint

1. **requireAuth** (existing: `router.use(authenticateToken)`)  
2. **Org context**: `x-org-id` header or `body.orgId` or `getOrgIdForUser(userId)`. If none → **400** "Organization context missing".  
3. **requireOrgMemberOrOwner**: `userHasAccessToOrg(userId, resolvedOrgId)` (owner, OrgMember, or OwnerTeamMember of that org). If false → **403** "You do not have access to this organization".  
4. **requirePermission**: existing route middleware `requirePermission("product.create", "org.write")`.

## Verification

- **Backend**: `npm run typecheck` and `npm run build` pass.  
- **Script**: From repo root, run `npm run verify:clone-auth` (requires DB with org + optional owner and team member).  
- **Manual (3 steps)**:
  1. Log in as **organization owner** → open Owner → Products → Master Catalog → clone a product → should succeed.
  2. Log in as **Owner Team member** (added by owner to a team with Products scope) → same path → clone → should succeed.
  3. Log in as a **user with no org membership** → same path → clone → should get 400 "Organization context missing" or 403 "You do not have access to this organization" (non-members still blocked).

## Non-members unchanged

Users who are neither org owner, nor OrgMember, nor OwnerTeamMember for that org still get 403 (or 400 if no org context can be resolved). No change to that behavior.
