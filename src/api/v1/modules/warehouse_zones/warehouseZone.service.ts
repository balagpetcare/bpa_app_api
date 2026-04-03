import prisma from "../../../../infrastructure/db/prismaClient";
import { logWarehouseAudit } from "../warehouse/warehouseAudit.service";

export async function listZones(warehouseId: number, orgId: number) {
  const wh = await prisma.warehouse.findFirst({
    where: { id: warehouseId, orgId },
    select: { id: true },
  });
  if (!wh) throw new Error("Warehouse not found");
  return prisma.warehouseZone.findMany({
    where: { warehouseId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    include: { _count: { select: { locations: true } } },
  });
}

export async function createZone(
  warehouseId: number,
  orgId: number,
  data: { code: string; name: string; purpose?: string; sortOrder?: number; note?: string }
) {
  const wh = await prisma.warehouse.findFirst({
    where: { id: warehouseId, orgId },
    select: { id: true },
  });
  if (!wh) throw new Error("Warehouse not found");
  const row = await prisma.warehouseZone.create({
    data: {
      warehouseId,
      code: data.code.trim(),
      name: data.name.trim(),
      purpose: (data.purpose as any) || "GENERAL",
      sortOrder: data.sortOrder ?? 0,
      note: data.note ?? null,
    },
  });
  await logWarehouseAudit({
    orgId,
    warehouseId,
    category: "ZONE",
    action: "ZONE_CREATE",
    entityType: "WarehouseZone",
    entityId: String(row.id),
    metadata: { code: row.code, name: row.name },
    actorUserId: null,
  });
  return row;
}

export async function updateZone(
  zoneId: number,
  warehouseId: number,
  orgId: number,
  data: { name?: string; purpose?: string; sortOrder?: number; isActive?: boolean; note?: string | null }
) {
  const z = await prisma.warehouseZone.findFirst({
    where: { id: zoneId, warehouseId, warehouse: { orgId } },
  });
  if (!z) throw new Error("Zone not found");
  const row = await prisma.warehouseZone.update({
    where: { id: zoneId },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.purpose !== undefined ? { purpose: data.purpose as any } : {}),
      ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.note !== undefined ? { note: data.note } : {}),
    },
  });
  await logWarehouseAudit({
    orgId,
    warehouseId,
    category: "ZONE",
    action: "ZONE_UPDATE",
    entityType: "WarehouseZone",
    entityId: String(zoneId),
    metadata: { patch: data },
    actorUserId: null,
  });
  return row;
}

export async function setLocationZone(
  locationId: number,
  warehouseId: number,
  orgId: number,
  zoneId: number | null
) {
  const loc = await prisma.inventoryLocation.findFirst({
    where: { id: locationId, warehouseId, branch: { orgId } },
    select: { id: true },
  });
  if (!loc) throw new Error("Location not found or not linked to this warehouse");
  if (zoneId != null) {
    const z = await prisma.warehouseZone.findFirst({
      where: { id: zoneId, warehouseId, warehouse: { orgId } },
    });
    if (!z) throw new Error("Zone not in this warehouse");
  }
  const row = await prisma.inventoryLocation.update({
    where: { id: locationId },
    data: { zoneId: zoneId ?? null },
    select: { id: true, name: true, zoneId: true, type: true },
  });
  await logWarehouseAudit({
    orgId,
    warehouseId,
    category: "ZONE",
    action: "LOCATION_ZONE_SET",
    entityType: "InventoryLocation",
    entityId: String(locationId),
    metadata: { zoneId: zoneId ?? null },
    actorUserId: null,
  });
  return row;
}
