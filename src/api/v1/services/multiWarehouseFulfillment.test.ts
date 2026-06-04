/**
 * Multi-warehouse fulfillment: pure logic, error mapping, and FEFO batch slicing.
 * DATABASE_URL is set before importing modules that load Prisma.
 */
import {
  MultiWarehouseFulfillmentError,
  MW_CODES,
  parseMultiWarehouseError,
  userMessageForCode,
} from "./multiWarehouseFulfillment.errors";

describe("multiWarehouseFulfillment.errors", () => {
  it("exposes user-friendly message for MULTI_SOURCE_DISABLED", () => {
    expect(userMessageForCode(MW_CODES.MULTI_SOURCE_DISABLED)).toContain("Multi-warehouse");
  });

  it("parseMultiWarehouseError maps MultiWarehouseFulfillmentError", () => {
    const err = new MultiWarehouseFulfillmentError(MW_CODES.PLAN_VERSION_CONFLICT, { httpStatus: 409 });
    const p = parseMultiWarehouseError(err);
    expect(p.code).toBe(MW_CODES.PLAN_VERSION_CONFLICT);
    expect(p.httpStatus).toBe(409);
  });

  it("parseMultiWarehouseError maps version conflict message", () => {
    const p = parseMultiWarehouseError(new Error("Allocation plan was modified by another process; refresh and retry"));
    expect(p.code).toBe(MW_CODES.PLAN_VERSION_CONFLICT);
    expect(p.httpStatus).toBe(409);
  });

  it("parseMultiWarehouseError maps insufficient lot stock", () => {
    const p = parseMultiWarehouseError(new Error("Insufficient lot stock. type=RESERVE_FULFILLMENT"));
    expect(p.code).toBe(MW_CODES.RESERVE_INSUFFICIENT);
    expect(p.httpStatus).toBe(409);
  });
});

describe("allocateVariantFifoUpToFromBatchContext (FEFO batch)", () => {
  let allocateVariantFifoUpToFromBatchContext: typeof import("../modules/inventory/fefoAllocation.service").allocateVariantFifoUpToFromBatchContext;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test_db";
    }
    const m = await import("../modules/inventory/fefoAllocation.service");
    allocateVariantFifoUpToFromBatchContext = m.allocateVariantFifoUpToFromBatchContext;
  });

  const baseCtx = (): import("../modules/inventory/fefoAllocation.service").FefoLocationBatchContext => ({
    sellable: true,
    rowsByVariant: new Map([
      [
        10,
        [
          { lotId: 1, variantId: 10, onHandQty: 100, reservedQty: 0, expDate: new Date("2026-06-01") },
          { lotId: 2, variantId: 10, onHandQty: 50, reservedQty: 0, expDate: new Date("2026-12-01") },
        ],
      ],
    ]),
    recallFrozen: new Set<number>(),
    qcPending: new Map<number, number>(),
  });

  it("full fulfillment: takes FEFO order across lots", () => {
    const ctx = baseCtx();
    const { slices, shortBy } = allocateVariantFifoUpToFromBatchContext(ctx, 100, 10, 120);
    expect(shortBy).toBe(0);
    expect(slices.length).toBe(2);
    expect(slices[0].quantity).toBe(100);
    expect(slices[1].quantity).toBe(20);
  });

  it("partial fulfillment: shortage when demand exceeds all lots", () => {
    const ctx = baseCtx();
    const { slices, shortBy } = allocateVariantFifoUpToFromBatchContext(ctx, 100, 10, 200);
    const sum = slices.reduce((s, x) => s + x.quantity, 0);
    expect(sum).toBe(150);
    expect(shortBy).toBe(50);
  });

  it("respects recall freeze (skip lot)", () => {
    const ctx = baseCtx();
    ctx.recallFrozen = new Set([1]);
    const { slices, shortBy } = allocateVariantFifoUpToFromBatchContext(ctx, 100, 10, 120);
    expect(slices.every((s) => s.lotId !== 1)).toBe(true);
    expect(shortBy).toBe(70);
  });

  it("non-sellable location yields nothing", () => {
    const ctx = baseCtx();
    ctx.sellable = false;
    const { slices, shortBy } = allocateVariantFifoUpToFromBatchContext(ctx, 100, 10, 10);
    expect(slices.length).toBe(0);
    expect(shortBy).toBe(10);
  });
});
