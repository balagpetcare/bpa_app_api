# API Quick Test (Phase-1 Option-2)

Mount:
```ts
import { adminPhase1Router } from "./src/routes/admin.phase1.routes";
app.use("/api/v1", adminPhase1Router);
```

## Dev headers (if using Phase-0 auth_context fallback)
- x-user-id: <existing userId>
- x-org-id: <orgId>

## Permissions
GET /api/v1/admin/permissions

## Roles
GET /api/v1/admin/roles
POST /api/v1/admin/roles
Body: { "key": "SUPPORT", "name": "Support" }

PATCH /api/v1/admin/roles/:id
Body: { "name": "Support Team" }

POST /api/v1/admin/roles/:id/permissions
Body: { "keys": ["branch.read","staff.read"] }

## Staff
GET /api/v1/admin/staff
POST /api/v1/admin/staff
Body: { "userId": 1, "fullName":"Mr X" }

POST /api/v1/admin/staff/:id/roles
Body: { "roleId": 1 }

POST /api/v1/admin/staff/:id/branches
Body: { "branchId": 1, "position": "Manager" }