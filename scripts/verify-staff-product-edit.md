# Verify Staff Product Edit (Owner Panel RBAC)

## Prerequisites
- API running on port 3000.
- DB with at least: one Organization (ownerUserId = owner), one Branch, one Product (orgId = that org), one OwnerTeam (ownerUserId = owner), one OwnerTeamMember (teamId, userId = staff), OwnerDelegation for that staff with scopeKey `products` (and optional orgId/branchId), UserContext for staff with ownerUserId = owner, teamId = team.

## Manual steps

### 1. As owner
- Log in to owner panel (e.g. `/owner/login`).
- Create org/branch/product if needed; create team, invite staff with **products** scope, accept invite (so staff has OwnerTeamMember + OwnerDelegation + UserContext).

### 2. As staff (team member)
- Log in with the staff account that has products scope.
- Open `/owner/products/<id>/edit` (use a product id that belongs to the same org as the team’s owner).
- **Expect**: No 403 on page load; sidebar/counts may load (GET /owner/organizations, /owner/branches, /owner/staffs, /owner/requests?summary=1, /owner/notifications return 200 with scoped data).
- **Expect**: Product loads (GET /api/v1/products/:id 200).
- Edit and save: **Expect** PATCH /api/v1/products/:id 200.

### 3. Staff without product scope
- Use a staff user that has no `products` scope (and no OWNER role).
- Open `/owner/products/1/edit`.
- **Expect**: 403 on PATCH (and possibly GET product if product not in their org); UI shows friendly message.

### 4. Owner regression
- Log in as owner; open same product edit page and PATCH.
- **Expect**: Full access, 200.

## Optional curl checks (after login; set COOKIE or Bearer token)

```bash
# Replace BASE and COOKIE (or use -H "Authorization: Bearer <token>")
BASE=http://localhost:3000
COOKIE="access_token=..."

# Staff: owner panel lists (expect 200)
curl -s -o /dev/null -w "%{http_code}" "$BASE/api/v1/owner/organizations" -H "Cookie: $COOKIE"
curl -s -o /dev/null -w "%{http_code}" "$BASE/api/v1/owner/branches" -H "Cookie: $COOKIE"
curl -s -o /dev/null -w "%{http_code}" "$BASE/api/v1/owner/staffs" -H "Cookie: $COOKIE"
curl -s -o /dev/null -w "%{http_code}" "$BASE/api/v1/owner/requests?summary=1" -H "Cookie: $COOKIE"
curl -s -o /dev/null -w "%{http_code}" "$BASE/api/v1/owner/notifications" -H "Cookie: $COOKIE"

# Staff: product (expect 200 for product in their org)
curl -s -o /dev/null -w "%{http_code}" "$BASE/api/v1/products/1" -H "Cookie: $COOKIE"

# Staff: PATCH product (expect 200)
curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/v1/products/1" -H "Cookie: $COOKIE" -H "Content-Type: application/json" -d '{"name":"Updated"}'
```

Acceptance: Staff with correct permissions get 200 on these calls; staff without product scope get 403 on PATCH; owners get 200 with no regression.
