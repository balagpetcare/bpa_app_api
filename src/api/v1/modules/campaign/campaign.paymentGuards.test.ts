import {
  buildCampaignOrderNotes,
  getBookingCheckInBlockReason,
  getVaccinationPaymentBlockReason,
  isCampaignPaymentCleared,
  parseCampaignBookingIdFromOrderNotes,
  parseIdempotencyKeyFromOrderNotes,
} from "./campaign.paymentGuards";

describe("campaign.paymentGuards", () => {
  it("blocks DRAFT bookings from check-in", () => {
    expect(
      getBookingCheckInBlockReason({ status: "DRAFT", paymentStatus: "PENDING" })
    ).toMatch(/Payment required/);
  });

  it("allows confirmed paid bookings", () => {
    expect(
      getBookingCheckInBlockReason({ status: "CONFIRMED", paymentStatus: "COMPLETED" })
    ).toBeNull();
  });

  it("blocks vaccination when payment pending", () => {
    expect(getVaccinationPaymentBlockReason("PENDING")).toMatch(/Payment must be completed/);
  });

  it("allows vaccination when payment not required", () => {
    expect(getVaccinationPaymentBlockReason("NOT_REQUIRED")).toBeNull();
    expect(isCampaignPaymentCleared("COMPLETED")).toBe(true);
  });

  it("parses campaign booking id from order notes", () => {
    const notes = buildCampaignOrderNotes(99, "abc123");
    expect(parseCampaignBookingIdFromOrderNotes(notes)).toBe(99);
    expect(parseIdempotencyKeyFromOrderNotes(notes)).toBe("abc123");
  });
});
