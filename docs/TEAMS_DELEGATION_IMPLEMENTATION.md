# Teams & Delegation – Owner Module Implementation

## Summary
- **POST /api/v1/owner/teams** creates a team. Body: `{ name, description?, scopes? }`. Owner is set server-side from `req.user.id` (do not send `owner_id` from client).
- Valid scope keys: `products`, `clinics`, `inventory`, `staff`, `branches`, `finance_read` (Products, Clinics, Inventory, Staff, Branches, Finance Read Only).
- Team name must be unique per owner; duplicate names return `409` with `error: "A team with this name already exists."`.
- Invalid scope keys return `400` with `error: "Invalid scope: <key>"`.
- Responses: `{ success: true, data: team }` or `{ success: false, error: "message" }`.

## Database
- **owner_teams**: added optional `scopes` (JSONB) and unique index `(ownerUserId, name)`.
- Migration: `prisma/migrations/20260207180001_owner_teams_scopes_and_unique_name`.
- If you have existing duplicate team names per owner, fix or merge them before running the migration.

## Apply migration
```bash
cd backend-api
npx prisma migrate deploy
# or in dev: npx prisma migrate dev
npx prisma generate
```

## Valid scope keys
From `delegationScopes`: `products`, `clinics`, `inventory`, `staff`, `branches`, `finance_read`. Assigned scopes apply to delegations when linking a delegation to a team (`teamId`); owner can only view/edit their own teams (filtered by `ownerUserId`).
