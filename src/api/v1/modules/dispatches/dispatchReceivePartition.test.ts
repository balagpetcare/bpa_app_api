/**
 * @jest-environment node
 */
import {
  assertReceiveItemsHaveDiscrepancyNotes,
  validateReceiveBatchAgainstRemaining,
  lineRemainingBeforeBatch,
} from "./dispatchReceivePartition";

const baseLine = {
  variantId: 1,
  lotId: 1,
  quantityDispatched: 600,
  quantityReceived: 0,
  quantityDamaged: 0,
  quantityShort: 0,
};

describe("dispatchReceivePartition", () => {
  it("lineRemainingBeforeBatch", () => {
    expect(lineRemainingBeforeBatch(baseLine)).toBe(600);
    expect(
      lineRemainingBeforeBatch({
        ...baseLine,
        quantityReceived: 100,
        quantityDamaged: 50,
        quantityShort: 25,
      })
    ).toBe(425);
  });

  it("strict partition: sum must equal remaining when remaining > 0", () => {
    expect(validateReceiveBatchAgainstRemaining(baseLine, { quantityReceived: 600, quantityDamaged: 0, quantityShort: 0 })).toBeNull();
    expect(validateReceiveBatchAgainstRemaining(baseLine, { quantityReceived: 590, quantityDamaged: 10, quantityShort: 0 })).toBeNull();
    expect(validateReceiveBatchAgainstRemaining(baseLine, { quantityReceived: 575, quantityDamaged: 10, quantityShort: 15 })).toBeNull();
    expect(
      validateReceiveBatchAgainstRemaining(baseLine, { quantityReceived: 500, quantityDamaged: 10, quantityShort: 15 }, { relaxRemainingPartition: false })
    ).toMatch(/must equal the line remaining/);
  });

  it("damage + shortage over remaining is rejected", () => {
    expect(
      validateReceiveBatchAgainstRemaining(baseLine, { quantityReceived: 0, quantityDamaged: 400, quantityShort: 250 })
    ).toMatch(/cannot exceed remaining/);
  });

  it("relax allows partial batch without strict equality", () => {
    expect(
      validateReceiveBatchAgainstRemaining(baseLine, { quantityReceived: 300, quantityDamaged: 0, quantityShort: 0 }, { relaxRemainingPartition: true })
    ).toBeNull();
  });

  it("excess is independent of accepted+damage+short partition", () => {
    expect(
      validateReceiveBatchAgainstRemaining(baseLine, {
        quantityReceived: 600,
        quantityDamaged: 0,
        quantityShort: 0,
        excessQty: 5,
      })
    ).toBeNull();
    expect(validateReceiveBatchAgainstRemaining(baseLine, { quantityReceived: 600, quantityDamaged: 0, quantityShort: 0, excessQty: -1 })).toMatch(
      /cannot be negative/
    );
  });

  it("assert: excess requires reason + details", () => {
    expect(() =>
      assertReceiveItemsHaveDiscrepancyNotes([baseLine], [
        { variantId: 1, lotId: 1, quantityReceived: 600, quantityDamaged: 0, quantityShort: 0, excessQty: 5, reasonCode: "", lineNote: "" },
      ])
    ).toThrow(/choose a discrepancy reason/);

    expect(() => {
      assertReceiveItemsHaveDiscrepancyNotes([baseLine], [
        {
          variantId: 1,
          lotId: 1,
          quantityReceived: 600,
          quantityDamaged: 0,
          quantityShort: 0,
          excessQty: 5,
          reasonCode: "OVER_DELIVERED",
          lineNote: "Two extra cartons on pallet; segregated for warehouse callback.",
        },
      ]);
    }).not.toThrow();
  });

  it("assert: damage requires reason + details", () => {
    expect(() =>
      assertReceiveItemsHaveDiscrepancyNotes([baseLine], [
        { variantId: 1, lotId: 1, quantityReceived: 590, quantityDamaged: 10, quantityShort: 0, reasonCode: "", lineNote: "" },
      ])
    ).toThrow(/choose a discrepancy reason/);

    expect(() =>
      assertReceiveItemsHaveDiscrepancyNotes([baseLine], [
        {
          variantId: 1,
          lotId: 1,
          quantityReceived: 590,
          quantityDamaged: 10,
          quantityShort: 0,
          reasonCode: "DAMAGED_IN_TRANSIT",
          lineNote: "ab",
        },
      ])
    ).toThrow(/at least 5 characters/);

    expect(() => {
      assertReceiveItemsHaveDiscrepancyNotes([baseLine], [
        {
          variantId: 1,
          lotId: 1,
          quantityReceived: 590,
          quantityDamaged: 10,
          quantityShort: 0,
          reasonCode: "DAMAGED_IN_TRANSIT",
          lineNote: "Damaged outer cartons, held aside for photos.",
        },
      ]);
    }).not.toThrow();
  });

  it("assert: relax partial envelope without damage needs note only", () => {
    expect(() => {
      assertReceiveItemsHaveDiscrepancyNotes(
        [baseLine],
        [{ variantId: 1, lotId: 1, quantityReceived: 300, quantityDamaged: 0, quantityShort: 0, lineNote: "Shor" }],
        { relaxRemainingPartition: true }
      );
    }).toThrow(/at least 5 characters/);

    expect(() => {
      assertReceiveItemsHaveDiscrepancyNotes(
        [baseLine],
        [
          {
            variantId: 1,
            lotId: 1,
            quantityReceived: 300,
            quantityDamaged: 0,
            quantityShort: 0,
            lineNote: "Receiving only first carton today; balance next vehicle.",
          },
        ],
        { relaxRemainingPartition: true }
      );
    }).not.toThrow();
  });
});
