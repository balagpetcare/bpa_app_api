/**
 * Owner direct dispatch: create StockRequest + StockDispatch from bulk receive lines.
 * Auto-allocates lots from source warehouse (FEFO). Status CREATED; owner sends via sendDispatch.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
const ledgerService = require("./ledger.service");
const dispatchService = require("../dispatches/dispatches.service");

const BRANCH_LOCATION_TYPES = ["BRANCH_STORE", "SHOP", "CLINIC", "CLINIC_STORE"] as const;
const WAREHOUSE_LOCATION_TYPES = ["CENTRAL_WAREHOUSE"] as const;
const LINES_LIMIT = 200;

export type DirectDispatchLineInput = {
  variantId: number;
  quantity: number;
};

export type CreateDirectDispatchInput = {
  orgId: number;
  fromLocationId: number;
  toLocationId: number;
  lines: DirectDispatchLineInput[];
  reference?: string;
  note?: string;
  actorUserId: number;
};

export type CreateDirectDispatchResult = {
  stockRequestId: number;
  dispatchId: number;
  dispatch: Awaited<ReturnType<typeof dispatchService.getDispatchById>>;
};

async function allocateLotsFromLocation(
  locationId: number,
  lines: DirectDispatchLineInput[],
  getAvailableLotsFEFO: (locationId: number, variantId: number) => Promise<Array<{ lotId: number; availableQty: number }>>
): Promise<Array<{ variantId: number; lotId: number; quantity: number }>> {
  const byVariant = new Map<number, number>();
  for (const line of lines) {
    if (line.quantity <= 0) continue;
    byVariant.set(line.variantId, (byVariant.get(line.variantId) ?? 0) + line.quantity);
  }
  const result: Array<{ variantId: number; lotId: number; quantity: number }> = [];
  for (const [variantId, qty] of byVariant) {
    const lots = await getAvailableLotsFEFO(locationId, variantId);
    let remaining = qty;
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, lot.availableQty);
      if (take > 0) {
        result.push({ variantId, lotId: lot.lotId, quantity: take });
        remaining -= take;
      }
    }
    if (remaining > 0) {
      throw new Error(
        `Insufficient stock at source for variant ${variantId}. Requested: ${qty}, Shortfall: ${remaining}`
      );
    }
  }
  return result;
}

export async function createDirectDispatch(data: CreateDirectDispatchInput): Promise<CreateDirectDispatchResult> {
  if (!data.lines?.length) throw new Error("At least one line required");
  if (data.lines.length > LINES_LIMIT) throw new Error(`Lines limit is ${LINES_LIMIT}`);

  const [fromLocation, toLocation] = await Promise.all([
    prisma.inventoryLocation.findUnique({ where: { id: data.fromLocationId }, include: { branch: true } }),
    prisma.inventoryLocation.findUnique({ where: { id: data.toLocationId }, include: { branch: true } }),
  ]);

  if (!fromLocation || fromLocation.branch.orgId !== data.orgId) {
    throw new Error("Source location not found or not in organization");
  }
  if (!toLocation || toLocation.branch.orgId !== data.orgId) {
    throw new Error("Destination location not found or not in organization");
  }
  if (!WAREHOUSE_LOCATION_TYPES.includes(fromLocation.type as (typeof WAREHOUSE_LOCATION_TYPES)[number])) {
    throw new Error("Source location must be CENTRAL_WAREHOUSE");
  }
  if (!BRANCH_LOCATION_TYPES.includes(toLocation.type as (typeof BRANCH_LOCATION_TYPES)[number])) {
    throw new Error("Destination must be a branch location (BRANCH_STORE, SHOP, CLINIC, CLINIC_STORE)");
  }

  const branchId = toLocation.branchId;
  const variantIds = [...new Set(data.lines.map((l) => l.variantId))];
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, product: { orgId: data.orgId } },
    select: { id: true, productId: true },
  });
  const variantMap = new Map(variants.map((v) => [v.id, v]));
  for (const line of data.lines) {
    if (!variantMap.has(line.variantId)) {
      throw new Error(`Variant ${line.variantId} not found or not in organization`);
    }
  }

  const getAvailableLotsFEFO = async (locationId: number, variantId: number) => {
    const lots = await ledgerService.getAvailableLotsFEFO(locationId, variantId);
    return lots.map((l: { lotId: number; availableQty?: number }) => ({
      lotId: l.lotId,
      availableQty: l.availableQty ?? 0,
    }));
  };

  const dispatchItems = await allocateLotsFromLocation(
    data.fromLocationId,
    data.lines,
    getAvailableLotsFEFO
  );

  const stockRequest = await prisma.stockRequest.create({
    data: {
      orgId: data.orgId,
      branchId,
      requesterUserId: data.actorUserId,
      status: "APPROVED",
      items: {
        create: data.lines.map((l) => {
          const v = variantMap.get(l.variantId)!;
          return { productId: v.productId, variantId: l.variantId, requestedQty: l.quantity };
        }),
      },
    },
    include: { items: true },
  });

  const dispatch = await dispatchService.createDispatch({
    orgId: data.orgId,
    stockRequestId: stockRequest.id,
    fromLocationId: data.fromLocationId,
    toLocationId: data.toLocationId,
    items: dispatchItems,
    createdByUserId: data.actorUserId,
  });

  const fullDispatch = await dispatchService.getDispatchById(dispatch.id);
  return { stockRequestId: stockRequest.id, dispatchId: dispatch.id, dispatch: fullDispatch! };
}
