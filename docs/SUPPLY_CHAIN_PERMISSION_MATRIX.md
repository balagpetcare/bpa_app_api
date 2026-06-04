# Supply chain permission matrix (reference)

Source of truth for **keys** and **role seeds**: `prisma/seeders/seedRolesPermissions.ts` and `src/api/v1/services/permissionsRegistry.service.ts`.

## Procurement demand (new / emphasized)

| Key | Typical use |
|-----|-------------|
| `procurement.demand.view` | List/read demand |
| `procurement.demand.manage` | Link, cancel, process hooks |
| `procurement.demand.link_po` | Link demand ↔ PO line |

Seeded for roles such as **ORG_ADMIN** and **WAREHOUSE_MANAGER** (verify exact arrays in seeder before relying on a specific role).

## Backorder (fulfillment visibility)

| Key | Typical use |
|-----|-------------|
| `fulfillment.backorder.view` | Read backorder-oriented views |
| `fulfillment.backorder.process` | Operational processing (if wired to routes) |

## Related existing keys (non-exhaustive)

| Key | Area |
|-----|------|
| `inventory.read` / `inventory.write` | Owner menu and inventory surfaces |
| `procurement.po.view` / `procurement.po.manage` | Purchase orders |
| `inbound.grn`, `grn.post`, `purchase.receive` | GRN receive and procurement process trigger |
| `warehouse.view` / `warehouse.manage` | Warehouse panels |
| `warehouse.operations` | Operations hub / putaway-related entry |

## Owner menu (`bpa_web/src/lib/permissionMenu.ts`)

“Procurement demand” requires **any of**: `procurement.demand.view`, `procurement.po.manage`, `inventory.read` (see file for exact `required` array).

## Route guards

- `/api/v1/procurement-demand/*` — `requirePermission` on router (see `procurementDemand.routes.ts`).
- `/api/v1/stock-requests/*` — `authenticateToken`; **per-action authorization in controller** (important for reviews).

## Known legacy breadth

Some helpers still accept `inventory.update` alongside newer keys (e.g. stock request create for warehouse hubs). Tracked as standardization backlog in `SUPPLY_CHAIN_SECURITY_VALIDATION_SUMMARY.md`.
