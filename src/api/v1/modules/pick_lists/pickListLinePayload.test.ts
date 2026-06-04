/**
 * @jest-environment node
 */
import { parsePickListLineUpdatesFromBody } from "./pickListLinePayload";

describe("parsePickListLineUpdatesFromBody", () => {
  it("parses lineId + quantityPicked", () => {
    expect(parsePickListLineUpdatesFromBody({ lines: [{ lineId: 3, quantityPicked: 5 }] })).toEqual([
      { lineId: 3, quantityPicked: 5 },
    ]);
  });

  it("accepts id + pickedQty aliases", () => {
    expect(parsePickListLineUpdatesFromBody({ lines: [{ id: 2, pickedQty: 7 }] })).toEqual([{ lineId: 2, quantityPicked: 7 }]);
  });

  it("returns undefined for empty or invalid", () => {
    expect(parsePickListLineUpdatesFromBody(undefined)).toBeUndefined();
    expect(parsePickListLineUpdatesFromBody({})).toBeUndefined();
    expect(parsePickListLineUpdatesFromBody({ lines: [] })).toBeUndefined();
    expect(parsePickListLineUpdatesFromBody({ lines: [{ foo: 1 }] })).toBeUndefined();
  });
});
