import { Prisma } from "@prisma/client";

/**
 * Maps Prisma "schema behind code" errors to a single HTTP response shape so operators
 * see a migration hint instead of a raw Prisma message.
 *
 * - P2021: table does not exist (e.g. `purchase_orders` before enterprise migration).
 * - P2022: column does not exist (e.g. `inventory_locations.warehouseId` before foundation).
 */
export function tryRespondPrismaSchemaDrift(res: { status: (c: number) => { json: (b: unknown) => void } }, err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;

  if (err.code === "P2021") {
    res.status(503).json({
      success: false,
      code: "DATABASE_SCHEMA_DRIFT",
      message:
        "A required database table is missing. Apply migrations on this environment: npx prisma migrate deploy (confirm DATABASE_URL points at the intended database).",
      hint: "Warehouse enterprise tables (purchase_orders, allocation_plans, pick_lists, …) are created by migration 20260429120000_warehouse_enterprise_po_allocation_pick_pod.",
      prismaCode: err.code,
      meta: err.meta,
    });
    return true;
  }

  if (err.code === "P2022") {
    res.status(503).json({
      success: false,
      code: "DATABASE_SCHEMA_DRIFT",
      message:
        "A required database column is missing. Apply migrations on this environment: npx prisma migrate deploy (confirm DATABASE_URL points at the intended database).",
      hint: "Example: inventory_locations.warehouseId comes from 20260428150000_central_warehouse_foundation.",
      prismaCode: err.code,
      meta: err.meta,
    });
    return true;
  }

  return false;
}
