import {
  buildCheckoutOrderNotes,
  parseCheckoutSessionIdFromOrderNotes,
} from "./campaign.paymentGuards";

describe("campaign.paymentGuards checkout session parsing", () => {
  it("parses cuid checkout session id from order notes", () => {
    const notes = buildCheckoutOrderNotes("clxyz123abc456", "deadbeef");
    expect(parseCheckoutSessionIdFromOrderNotes(notes)).toBe("clxyz123abc456");
  });

  it("parses session ids with underscores and hyphens", () => {
    const notes = "campaign_checkout:clxyz-123_abc|idempotency:abc";
    expect(parseCheckoutSessionIdFromOrderNotes(notes)).toBe("clxyz-123_abc");
  });
});
