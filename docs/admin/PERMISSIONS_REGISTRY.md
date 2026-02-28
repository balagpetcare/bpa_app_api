# Permissions Registry (Human-Readable)

**Endpoint:** `GET /api/v1/admin/permissions`  
**Spec:** [PRODUCER_GOVERNANCE_MASTER_PLAN.md](./PRODUCER_GOVERNANCE_MASTER_PLAN.md) §4.2, §5.4, §10

## Purpose

Expose a **grouped, human-readable** list of permissions (key, label, group, description, scope) for admin and producer panels. Used for:

- UI display of permission labels (no raw keys as primary display).
- Role/permission assignment screens.
- Documentation and support.

Response format follows **Appendix A** DTO: `success`, `code`, `message`, `traceId`, `data`.

## Response Shape (default)

```json
{
  "success": true,
  "code": "OK",
  "message": "Human-readable permissions registry",
  "traceId": "trc_...",
  "data": {
    "groups": [
      {
        "group": "Governance",
        "permissions": [
          {
            "key": "admin.producers.read",
            "label": "View producers",
            "group": "Governance",
            "description": "List and view producer organizations and details.",
            "scope": "admin"
          }
        ]
      }
    ]
  }
}
```

## Scope

- **admin** — Used in admin panel (platform/country governance).
- **producer** — Used in producer panel (batch, product, printing, KYC, staff).
- **both** — Used in owner/shop/clinic and shared flows.

## Source of Keys

Keys are **read-only** aligned with:

1. **bpa_web/src/lib/permissionMenu.ts** — `required` arrays on menu items (owner, admin, producer, country, shop, clinic).
2. **bpa_web/src/larkon-admin/menu/adapters/adminRouteMap.ts** — Admin route keys (paths); permissions that gate those routes are mirrored in the registry.
3. **PRODUCER_GOVERNANCE_MASTER_PLAN.md §3.3** — `admin.producers.read`, `admin.producers.write`, `admin.approvals.manage`, `admin.kyc.manage`, `admin.audit.read`; producer.* keys.

Any permission used in the UI but not discoverable from the above is added manually in `permissionsRegistry.service.ts` with a comment.

## Groups (display order)

- Governance, Producer, Batch, Product, Printing, Codes, KYC  
- My Business, Products, Inventory, Orders, People, Reports, Settings  
- Clinic, Country Governance  

## Legacy DB list

For callers that need the **DB `Permission` table** list (e.g. role assignment dropdown):

- **GET** `/api/v1/admin/permissions?source=db`  
- Response: same envelope; `data.items` = array of DB Permission rows.

## Implementation

- **Service:** `src/api/v1/services/permissionsRegistry.service.ts` — `getGroupedRegistry()`.
- **Controller:** `src/api/v1/modules/admin_permissions/admin_permissions.controller.ts` — GET `/` with envelope and optional `?source=db`.
- **No breaking changes** to existing permission checks (middleware/backend); this endpoint is read-only metadata.
