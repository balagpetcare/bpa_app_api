export {};
const db = require("../../../../infrastructure/db/prismaClient").default;
const warehouseService = require("./warehouse.service");

async function getWarehouseSummary(warehouseId: number) {
  const dashboard = await warehouseService.getWarehouseDashboard(warehouseId);

  const locs = await db.inventoryLocation.findMany({
    where: { warehouseId, isActive: true },
    select: { id: true },
  });
  const ids = locs.map((l: { id: number }) => l.id);

  let activeDeliveryAssignments = 0;
  let openDispatches = 0;
  if (ids.length) {
    [activeDeliveryAssignments, openDispatches] = await Promise.all([
      db.deliveryAssignment.count({
        where: {
          status: { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED"] },
          dispatch: { fromLocationId: { in: ids } },
        },
      }),
      db.stockDispatch.count({
        where: {
          fromLocationId: { in: ids },
          status: { in: ["CREATED", "PACKED", "IN_TRANSIT"] },
        },
      }),
    ]);
  }

  return {
    ...dashboard,
    activeDeliveryAssignments,
    openDispatchesFromWarehouse: openDispatches,
  };
}

module.exports = { getWarehouseSummary };
