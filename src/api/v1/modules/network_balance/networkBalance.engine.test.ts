import { shortageUnits, surplusUnits, greedyMatch } from "./networkBalance.engine";

describe("networkBalance.engine", () => {
  const base = {
    locationId: 1,
    branchId: 1,
    availableQty: 10,
    inboundPipelineQty: 0,
    minStock: 2,
    maxStock: 20,
    reorderPoint: 5,
    priorityWeight: 1,
  };

  it("shortageUnits when below ROP", () => {
    expect(shortageUnits({ ...base, availableQty: 2, reorderPoint: 5 })).toBe(3);
  });

  it("surplusUnits when above max", () => {
    expect(surplusUnits({ ...base, availableQty: 30, maxStock: 20 })).toBe(10);
  });

  it("greedyMatch pairs surplus to shortage when route allowed", () => {
    const m = greedyMatch({
      variantId: 99,
      surplusNodes: [{ locationId: 10, surplus: 8 }],
      shortageNodes: [{ locationId: 20, shortage: 5, score: 5 }],
      minMoveQty: 1,
      routeAllowed: () => true,
    });
    expect(m.length).toBe(1);
    expect(m[0].qty).toBe(5);
    expect(m[0].fromLocationId).toBe(10);
    expect(m[0].toLocationId).toBe(20);
  });

  it("greedyMatch respects routeAllowed", () => {
    const m = greedyMatch({
      variantId: 99,
      surplusNodes: [{ locationId: 10, surplus: 8 }],
      shortageNodes: [{ locationId: 20, shortage: 5, score: 5 }],
      minMoveQty: 1,
      routeAllowed: () => false,
    });
    expect(m.length).toBe(0);
  });
});
