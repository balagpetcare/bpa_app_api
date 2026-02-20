/**
 * Unit tests for bulk receive line validation (validateBulkReceiveLines).
 * Ensures quantity > 0, variant in org, requiresLot/requiresExpiry/requiresMfg, exp > mfg, exp in future.
 */
const prismaMock = {
  productVariant: {
    findMany: jest.fn(),
  },
};

jest.mock("../../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: prismaMock,
}));

const grnService = require("./grn.service");

describe("validateBulkReceiveLines", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns error when no lines", async () => {
    const errors = await grnService.validateBulkReceiveLines(1, []);
    expect(errors).toHaveLength(1);
    expect(errors[0].rowIndex).toBe(0);
    expect(errors[0].message).toMatch(/at least one line/i);
  });

  it("returns error when quantity <= 0", async () => {
    prismaMock.productVariant.findMany.mockResolvedValue([
      { id: 1, requiresLot: false, requiresExpiry: false, requiresMfg: false },
    ]);
    const errors = await grnService.validateBulkReceiveLines(1, [
      { variantId: 1, quantity: 0 },
      { variantId: 1, quantity: -1 },
    ]);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((e: any) => e.message && e.message.includes("Quantity"))).toBe(true);
  });

  it("returns error when variant not in org", async () => {
    prismaMock.productVariant.findMany.mockResolvedValue([]);
    const errors = await grnService.validateBulkReceiveLines(1, [
      { variantId: 999, quantity: 5 },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/not found|organization/i);
  });

  it("returns error when requiresLot but no lotCode", async () => {
    prismaMock.productVariant.findMany.mockResolvedValue([
      { id: 1, requiresLot: true, requiresExpiry: false, requiresMfg: false },
    ]);
    const errors = await grnService.validateBulkReceiveLines(1, [
      { variantId: 1, quantity: 5 },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/lot code/i);
  });

  it("returns error when requiresExpiry but exp in past", async () => {
    prismaMock.productVariant.findMany.mockResolvedValue([
      { id: 1, requiresLot: false, requiresExpiry: true, requiresMfg: false },
    ]);
    const past = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const errors = await grnService.validateBulkReceiveLines(1, [
      { variantId: 1, quantity: 5, expDate: past },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/future|expir/i);
  });

  it("returns error when exp <= mfg", async () => {
    prismaMock.productVariant.findMany.mockResolvedValue([
      { id: 1, requiresLot: false, requiresExpiry: false, requiresMfg: false },
    ]);
    const d = "2025-01-15";
    const errors = await grnService.validateBulkReceiveLines(1, [
      { variantId: 1, quantity: 5, mfgDate: d, expDate: d },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/after.*manufactur|expir.*mfg/i);
  });

  it("returns no errors for valid line", async () => {
    prismaMock.productVariant.findMany.mockResolvedValue([
      { id: 1, requiresLot: false, requiresExpiry: false, requiresMfg: false },
    ]);
    const future = new Date(Date.now() + 86400000 * 100).toISOString().slice(0, 10);
    const errors = await grnService.validateBulkReceiveLines(1, [
      { variantId: 1, quantity: 5, expDate: future, mfgDate: "2025-01-01" },
    ]);
    expect(errors).toHaveLength(0);
  });
});

export {};
