# GET /api/v1/producer/me — Response shape

**Enhancement (minimal):** The `me` endpoint returns two extra fields for Staff & Access Control UI (role/permission-based rendering).

## Response (success)

```json
{
  "success": true,
  "data": {
    "user": { "id", "profile", "auth", ... },
    "org": { "id", "name", "status", "ownerUserId", ... },
    "permissions": ["producer.org.read", "producer.products.read", ...],
    "isProducerOwner": true
  }
}
```

- **permissions:** Array of permission keys for the current user in this producer context (from `resolvePermissionsForUser(userId)`). Used by the frontend to gate actions (e.g. `producer.staff.read`, `producer.staff.invite`).
- **isProducerOwner:** `true` when the authenticated user is the owner of the producer org (`org.ownerUserId === userId`). Owner is treated as having all staff permissions on the frontend.

No breaking change: existing clients can ignore the new fields. Implemented in `producer.service.ts` `getMe()`.
