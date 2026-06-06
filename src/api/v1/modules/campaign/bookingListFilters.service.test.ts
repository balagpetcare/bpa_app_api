import { buildBookingListWhere } from "./bookingListFilters.util";

describe("buildBookingListWhere", () => {
  const base = { campaignId: 1 };

  it("filters by city corporation code in address JSON", () => {
    const where = buildBookingListWhere({ ...base, cityCorporation: "DSCC" });
    expect(JSON.stringify(where)).toContain("cityCorporationCode");
  });

  it("filters by area on bookingArea column", () => {
    const where = buildBookingListWhere({ ...base, area: "Rampura / Banasree" });
    expect(JSON.stringify(where)).toContain("bookingArea");
  });

  it("combines DSCC and area filters", () => {
    const where = buildBookingListWhere({
      ...base,
      cityCorporation: "DSCC",
      area: "Rampura / Banasree",
      status: "CONFIRMED",
    });
    const json = JSON.stringify(where);
    expect(json).toContain("DSCC");
    expect(json).toContain("Rampura");
    expect(json).toContain("CONFIRMED");
  });

  it("filters pet count range", () => {
    const where = buildBookingListWhere({ ...base, petCountMin: 1, petCountMax: 3 });
    expect(JSON.stringify(where)).toContain('"gte":1');
    expect(JSON.stringify(where)).toContain('"lte":3');
  });
});
