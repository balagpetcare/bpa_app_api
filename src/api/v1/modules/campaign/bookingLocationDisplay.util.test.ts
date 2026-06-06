import {
  formatBookingLocationLabel,
  resolveBookingLocationDisplay,
  resolveCityCorporationName,
  formatBookingLocationShortLabel,
  resolveBookingLocationFields,
} from "./bookingLocationDisplay.util";

describe("bookingLocationDisplay.util", () => {
  it("resolves DSCC + area from booking columns", () => {
    const display = resolveBookingLocationDisplay({
      bookingMode: "ZONE_INTEREST",
      bookingArea: "Rampura / Banasree",
      ownerAddressJson: { cityCorporationCode: "DSCC", bookingMode: "ZONE_INTEREST" },
    });

    expect(display?.cityCorporation).toBe("Dhaka South City Corporation");
    expect(display?.area).toBe("Rampura / Banasree");
    expect(formatBookingLocationShortLabel(display)).toBe("DSCC → Rampura / Banasree");
    expect(formatBookingLocationLabel(display)).toBe(
      "Dhaka South City Corporation → Rampura / Banasree"
    );
  });

  it("resolveBookingLocationFields returns API shape", () => {
    const fields = resolveBookingLocationFields({
      bookingMode: "ZONE_INTEREST",
      bookingArea: "Rampura / Banasree",
      ownerAddressJson: { cityCorporationCode: "DSCC" },
    });
    expect(fields).toEqual({
      cityCorporation: "Dhaka South City Corporation",
      cityCorporationCode: "DSCC",
      area: "Rampura / Banasree",
      locationLabel: "DSCC → Rampura / Banasree",
    });
  });

  it("falls back to address JSON when bookingArea column is empty", () => {
    const display = resolveBookingLocationDisplay({
      bookingMode: "ZONE_INTEREST",
      ownerAddressJson: {
        cityCorporationCode: "DNCC",
        cityCorporationName: "Dhaka North City Corporation",
        bookingArea: "Uttara Sector 7",
      },
    });

    expect(display?.area).toBe("Uttara Sector 7");
    expect(formatBookingLocationLabel(display)).toContain("Uttara Sector 7");
  });

  it("returns venue location when locationId is set", () => {
    const display = resolveBookingLocationDisplay({
      location: { id: 5, name: "Banani Field Clinic" },
    });

    expect(display?.name).toBe("Banani Field Clinic");
    expect(formatBookingLocationLabel(display)).toBe("Banani Field Clinic");
  });

  it("maps corporation codes to display names", () => {
    expect(resolveCityCorporationName("dscc")).toBe("Dhaka South City Corporation");
    expect(resolveCityCorporationName("XX")).toBeUndefined();
  });
});
